// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IAdmin.sol";
import "./interfaces/IDistribution.sol";

contract AllocationStaking is OwnableUpgradeable {
    using SafeMath for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using ECDSA for bytes32;

    struct StakeRecord {
        uint256 id; // Stake id, NOT UNIQUE OVER ALL USERS, unique only among user's other stakes.
        uint256 index; // Index of the StakeRecord in the user.stakeIds array.
        uint256 amount; // Stake amount
        uint256 rewardDebt; // Current reward debt.
        uint256 tokensUnlockTime; // When stake tokens will unlock
        // Keep in mind, that multiplier might not be up to date
        // For example, if user's stake went into 14 days lock period after the initial unlock and he didn't manually relock it.
        // Or if getStakeMultiplierPercent was modified on contract upgrade.
        uint256 stakeMultiplierPercent; // Reward multiplier percent, applied to withdrawals
    }

    // Info of each user.
    struct UserInfo {
        uint256 totalAmount; // How many LP tokens the user has provided in all his stakes.
        uint256 totalRewarded; // How many tokens user got rewarded in total
        uint256 stakesCount; // How many new deposits user made overall
        uint256[] stakeIds; // User's current (not fully withdrawn) stakes ids
        mapping(uint256 => StakeRecord) stakes; // Stake's id to the StakeRecord mapping
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20Upgradeable lpToken; // Address of LP token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. ERC20s to distribute per block.
        uint256 lastRewardTimestamp; // Last timstamp that ERC20s distribution occurs.
        uint256 accERC20PerShare; // Accumulated ERC20s per share, times 1e36.
        uint256 totalDeposits; // Total amount of tokens deposited at the moment (staked)
        uint256 emptyTimestamp; // When pool's totalDeposits became empty. Used for accounting of missed rewards, that weren't issued.
        uint256 uniqueUsers; // How many unique users there are in the pool
    }

    // State of the contract
    enum ContractState {
        Operating,
        Halted
    }

    // Time to relock the stake after it's unlock
    uint256 public constant RELOCK_DAYS = 14;

    // Address of the ERC20 Token contract.
    IERC20Upgradeable public erc20;
    // Distribution contract address who can mint tokens
    IDistribution public distribution;
    // The total amount of ERC20 that's paid out as reward.
    uint256 public paidOut;
    // Total rewards not issued caused by empty pools
    uint256 public missedRewards;
    // Total amount of missed rewards tokens minted
    uint256 public missedRewardsMinted;
    // Precision of deposit fee
    uint256 public depositFeePrecision;
    // Percent of deposit fee, must be >= depositFeePrecision.div(100) and less than depositFeePrecision
    uint256 public depositFeePercent;
    // Share of the deposit fee, that will go to the staking pool in percents
    uint256 public depositFeePoolSharePercent;
    // Amount of the deposit fee collected and ready to claim by the owner
    uint256 public depositFeeCollected;
    // Total AVAT redistributed between people staking
    uint256 public totalAvatRedistributed;
    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;
    // The timestamp when staking starts.
    uint256 public startTimestamp;
    // Total amount of tokens burned from the wallet
    mapping(address => uint256) public totalBurnedFromUser;
    // Time when withdraw is allowed after the stake unlocks
    uint256 public withdrawAllowedDays;
    // Admin contract
    IAdmin public admin;
    // Contract state
    ContractState public contractState;

    // Events
    event Deposit(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 withdrawAmount, uint256 rewardAmount);
    event Rewards(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 amount);
    event Restake(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 unlockTime);
    event DepositFeeSet(uint256 depositFeePercent, uint256 depositFeePrecision);
    event CompoundedEarnings(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 amountAdded, uint256 totalDeposited);
    event FeeTaken(address indexed user, uint256 indexed pid, uint256 amount, uint256 poolShare);
    event EmergencyMint(address indexed recipient, uint256 amount);

    // Call can be processed only when the contract is in operating state
    modifier onlyOperating() {
        require(contractState == ContractState.Operating, "Contract is not operating currently");
        _;
    }

    function initialize(
        IERC20Upgradeable _erc20,
        IDistribution _distribution,
        uint256 _startTimestamp,
        uint256 _depositFeePercent,
        uint256 _depositFeePrecision,
        uint256 _depositFeePoolSharePercent,
        uint256 _withdrawAllowedDays
    ) public initializer {
        __Ownable_init();

        erc20 = _erc20;
        distribution = _distribution;

        startTimestamp = _startTimestamp;
        contractState = ContractState.Operating;

        setDepositFeeInternal(_depositFeePercent, _depositFeePrecision);
        depositFeePoolSharePercent = _depositFeePoolSharePercent;

        withdrawAllowedDays = _withdrawAllowedDays;
    }

    // Number of LP pools
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(
        uint256 _allocPoint,
        IERC20Upgradeable _lpToken,
        bool _withUpdate
    ) public onlyOwner {
        require(poolInfo.length > 0 || _lpToken == erc20, "First pool's lp token must be a reward token");
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardTimestamp = block.timestamp > startTimestamp ? block.timestamp : startTimestamp;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        // Push new PoolInfo
        poolInfo.push(PoolInfo({lpToken: _lpToken, allocPoint: _allocPoint, lastRewardTimestamp: lastRewardTimestamp, accERC20PerShare: 0, totalDeposits: 0, emptyTimestamp: lastRewardTimestamp, uniqueUsers: 0}));
    }

    // Set deposit fee
    function setDepositFee(uint256 _depositFeePercent, uint256 _depositFeePrecision) public onlyOwner {
        setDepositFeeInternal(_depositFeePercent, _depositFeePrecision);
    }

    // Set deposit fee internal
    function setDepositFeeInternal(uint256 _depositFeePercent, uint256 _depositFeePrecision) internal {
        require(_depositFeePercent >= _depositFeePrecision.div(100) && _depositFeePercent <= _depositFeePrecision);
        depositFeePercent = _depositFeePercent;
        depositFeePrecision = _depositFeePrecision;
        emit DepositFeeSet(depositFeePercent, depositFeePrecision);
    }

    // Claim all collected fees and send them to the recipient. Can only be called by the owner.
    function claimCollectedFees(address _recipient) external onlyOwner {
        require(depositFeeCollected > 0, "Zero fees to collect");
        erc20.transfer(_recipient, depositFeeCollected);
        depositFeeCollected = 0;
    }

    // Update the given pool's ERC20 allocation point. Can only be called by the owner. Always prefer to call with _withUpdate set to true.
    function setAllocation(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    // Sets new ERC20 minter address
    function setDistribution(IDistribution _distribution) public onlyOwner {
        distribution = _distribution;
    }

    // Gets reward multiplier for the stake duration
    // For 14 days ti's 0x
    // For 30 days it's 1x
    // For 45 days it's 1.5x
    // For 60 days it's 2x
    function getStakeMultiplierPercent(uint256 stakeDays) public pure returns (uint256) {
        // When you change stake days values, make sure you change the RELOCK_DAYS if needed;
        // Also be aware that restake assumes, that 0 multiplier means 14 days stake.
        require(stakeDays == 14 || stakeDays == 30 || stakeDays == 45 || stakeDays == 60, "Stake duration must equal to 14, 30, 45 or 60 days");
        return stakeDays >= 30 ? (stakeDays * 100) / 30 : 0;
    }

    // Calculate iAVAT amount for the user
    function getiAVATAmount(address _user) public view returns (uint256 iavat) {
        UserInfo storage user = userInfo[0][_user];
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            StakeRecord storage stake = user.stakes[user.stakeIds[i]];
            // We don't count the stake if it's on automatic 14 days relock
            if (block.timestamp > stake.tokensUnlockTime.add(withdrawAllowedDays.mul(1 days))) {
                continue;
            }
            iavat = iavat.add(stake.amount.mul(stake.stakeMultiplierPercent).div(100));
        }
    }

    // Get user's stakes count
    function userStakesCount(uint256 _pid, address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.stakeIds.length;
    }

    // Return user's stakes array
    function getUserStakes(uint256 _pid, address _user) public view returns (StakeRecord[] memory stakeArray) {
        UserInfo storage user = userInfo[_pid][_user];
        stakeArray = new StakeRecord[](user.stakeIds.length);
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            stakeArray[i] = user.stakes[user.stakeIds[i]];
        }
    }

    // Return user's specific stake
    function getUserStake(
        uint256 _pid,
        address _user,
        uint256 _stakeId
    ) public view returns (StakeRecord memory) {
        UserInfo storage user = userInfo[_pid][_user];
        require(user.stakes[_stakeId].id == _stakeId, "Stake with this id does not exist");
        return user.stakes[_stakeId];
    }

    // Return user's stake ids array
    function getUserStakeIds(uint256 _pid, address _user) public view returns (uint256[] memory) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.stakeIds;
    }

    // View function to see deposited LP for a particular user's stake.
    function deposited(
        uint256 _pid,
        address _user,
        uint256 _stakeId
    ) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "Stake with this id does not exist");
        return stake.amount;
    }

    // View function to see total deposited LP for a user.
    function totalDeposited(uint256 _pid, address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.totalAmount;
    }

    // View function to see pending ERC20s for a user's stake.
    function pending(
        uint256 _pid,
        address _user,
        uint256 _stakeId
    ) public view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "Stake with this id does not exist");

        uint256 accERC20PerShare = pool.accERC20PerShare;
        uint256 lpSupply = pool.totalDeposits;

        // Compute pending ERC20s
        if (block.timestamp > pool.lastRewardTimestamp && lpSupply != 0) {
            uint256 totalReward = distribution.countRewardAmount(pool.lastRewardTimestamp, block.timestamp);
            uint256 poolReward = totalReward.mul(pool.allocPoint).div(totalAllocPoint);
            accERC20PerShare = accERC20PerShare.add(poolReward.mul(1e36).div(lpSupply));
        }
        return stake.amount.mul(accERC20PerShare).div(1e36).sub(stake.rewardDebt);
    }

    // View function to see total pending ERC20s for a user.
    function totalPending(uint256 _pid, address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];

        uint256 pendingAmount = 0;
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            pendingAmount = pendingAmount.add(pending(_pid, _user, user.stakeIds[i]));
        }
        return pendingAmount;
    }

    // View function for total reward the contract has yet to pay out.
    // NOTE: this is not necessarily the sum of all pending sums on all pools and users
    //      example 1: when one pool has no LP supply
    function totalPoolPending() external view returns (uint256) {
        if (block.timestamp <= startTimestamp) {
            return 0;
        }

        return distribution.countRewardAmount(startTimestamp, block.timestamp).sub(paidOut).sub(missedRewards);
    }

    // Calculate pool's estimated APR. Returns APR in percents * 100.
    function getPoolAPR(uint256 _pid) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 reward = distribution.countRewardAmount(block.timestamp, block.timestamp.add(365 days));
        return reward.mul(pool.allocPoint).div(totalAllocPoint).mul(1e4).div(pool.totalDeposits);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        updatePoolWithFee(_pid, 0);
    }

    // Function to update pool with fee to redistribute amount between other stakers
    function updatePoolWithFee(uint256 _pid, uint256 _depositFee) internal {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 lastTimestamp = block.timestamp;

        if (lastTimestamp <= pool.lastRewardTimestamp) {
            lastTimestamp = pool.lastRewardTimestamp;
        }

        uint256 lpSupply = pool.totalDeposits;

        if (lpSupply == 0) {
            pool.lastRewardTimestamp = lastTimestamp;

            if (lastTimestamp > startTimestamp) {
                uint256 contractMissed = distribution.countRewardAmount(pool.emptyTimestamp, block.timestamp);
                missedRewards = missedRewards.add(contractMissed.mul(pool.allocPoint).div(totalAllocPoint));
                pool.emptyTimestamp = lastTimestamp;
            }

            return;
        }
        // Add to the reward fee taken, and distribute to all users staking at the moment.
        uint256 reward = distribution.countRewardAmount(pool.lastRewardTimestamp, lastTimestamp);
        uint256 erc20Reward = reward.mul(pool.allocPoint).div(totalAllocPoint).add(_depositFee);

        pool.accERC20PerShare = pool.accERC20PerShare.add(erc20Reward.mul(1e36).div(lpSupply));

        pool.lastRewardTimestamp = lastTimestamp;
    }

    // Check if it's the withdrawAllowedDays time window
    function isWithdrawAllowedTime(uint256 tokensUnlockTime) internal view returns (bool) {
        uint256 relockEpochTime = withdrawAllowedDays.add(RELOCK_DAYS).mul(1 days);
        uint256 timeSinceUnlock = block.timestamp.sub(tokensUnlockTime);
        return timeSinceUnlock.mod(relockEpochTime) < withdrawAllowedDays.mul(1 days);
    }

    // Deposit LP tokens to stake for ERC20 allocation.
    function deposit(
        uint256 _pid,
        uint256 _amount,
        uint256 stakeDays
    ) public onlyOperating {
        require(_amount > 0, "Should deposit positive amount");
        require(_pid < poolInfo.length, "Pool with such id does not exist");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        uint256 depositAmount = _amount;
        uint256 feePoolShare = 0;

        // Only for the main pool take fees
        if (_pid == 0) {
            uint256 depositFee = _amount.mul(depositFeePercent).div(depositFeePrecision);
            depositAmount = _amount.sub(depositFee);

            feePoolShare = depositFee.mul(depositFeePoolSharePercent).div(100);
            depositFeeCollected = depositFeeCollected.add(depositFee.sub(feePoolShare));
            // Update accounting around burning
            burnFromUser(msg.sender, feePoolShare);
            emit FeeTaken(msg.sender, _pid, depositFee, feePoolShare);
        }

        // Update pool including fee for people staking
        updatePoolWithFee(_pid, feePoolShare);

        // Safe transfer lpToken from user
        pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        // Add deposit to total deposits
        pool.totalDeposits = pool.totalDeposits.add(depositAmount);

        if (pool.totalDeposits > 0) {
            // we are not updating missedRewards here because it must've been done in the updatePoolWithFee
            pool.emptyTimestamp = 0;
        }

        // Increment if this is a new user of the pool
        if (user.stakesCount == 0) {
            pool.uniqueUsers = pool.uniqueUsers.add(1);
        }

        // Initialize a new stake record
        uint256 stakeId = user.stakesCount;
        require(user.stakes[stakeId].id == 0, "New stake record is not empty");

        StakeRecord storage stake = user.stakes[stakeId];
        // Set stake id
        stake.id = stakeId;
        // Set stake index in the user.stakeIds array
        stake.index = user.stakeIds.length;
        // Add deposit to user's amount
        stake.amount = depositAmount;
        // Update user's total amount
        user.totalAmount = user.totalAmount.add(depositAmount);
        // Compute reward debt
        stake.rewardDebt = stake.amount.mul(pool.accERC20PerShare).div(1e36);
        // Set lockup time
        stake.tokensUnlockTime = block.timestamp.add(stakeDays.mul(1 days));
        // Set reward multiplier
        stake.stakeMultiplierPercent = getStakeMultiplierPercent(stakeDays);

        // Push user's stake id
        user.stakeIds.push(stakeId);
        // Increase users's overall stakes count
        user.stakesCount = user.stakesCount.add(1);

        // Emit relevant event
        emit Deposit(msg.sender, _pid, stake.id, depositAmount);
    }

    // Withdraw LP tokens from pool.
    function withdraw(uint256 _pid, uint256 _stakeId) public onlyOperating {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        uint256 amount = stake.amount;

        require(stake.tokensUnlockTime <= block.timestamp, "Stake is not unlocked yet.");
        require(amount > 0, "Can't withdraw without an existing stake");

        // Withdraw can be called only for withdrawAllowedDays after the unlock and relocks for RELOCK_DAYS after.
        require(isWithdrawAllowedTime(stake.tokensUnlockTime), "Can only withdraw during the allowed time window after the unlock");

        // Update pool
        updatePool(_pid);

        // Compute user's pending amount
        uint256 pendingAmount = stake.amount.mul(pool.accERC20PerShare).div(1e36).sub(stake.rewardDebt);

        // Transfer pending amount to user
        erc20MintAndTransfer(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded.add(pendingAmount);
        user.totalAmount = user.totalAmount.sub(amount);

        stake.amount = 0;
        stake.rewardDebt = stake.amount.mul(pool.accERC20PerShare).div(1e36);

        // Transfer withdrawal amount to user (with fee being withdrawalFeeDepositAmount)
        pool.lpToken.safeTransfer(address(msg.sender), amount);
        pool.totalDeposits = pool.totalDeposits.sub(amount);

        if (pool.totalDeposits == 0 && block.timestamp > startTimestamp) {
            pool.emptyTimestamp = block.timestamp;
        }

        // Clean stake data since it's always a full withdraw
        {
            uint256 lastStakeId = user.stakeIds[user.stakeIds.length - 1];

            user.stakeIds[stake.index] = lastStakeId;
            user.stakeIds.pop();
            user.stakes[lastStakeId].index = stake.index;

            delete user.stakes[stake.id];
        }

        emit Withdraw(msg.sender, _pid, _stakeId, amount, pendingAmount);
    }

    // Collect staking rewards
    function collect(uint256 _pid, uint256 _stakeId) public onlyOperating {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.amount > 0, "Can't withdraw without an existing stake");

        // Update pool
        updatePool(_pid);

        // Compute user's pending amount
        uint256 pendingAmount = stake.amount.mul(pool.accERC20PerShare).div(1e36).sub(stake.rewardDebt);

        // Transfer pending amount to user
        erc20MintAndTransfer(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded.add(pendingAmount);
        stake.rewardDebt = stake.amount.mul(pool.accERC20PerShare).div(1e36);

        emit Rewards(msg.sender, _pid, _stakeId, pendingAmount);
    }

    // Change stake's lockup time
    function restake(
        uint256 _pid,
        uint256 _stakeId,
        uint256 _stakeDays
    ) public onlyOperating {
        UserInfo storage user = userInfo[_pid][msg.sender];
        StakeRecord storage stake = user.stakes[_stakeId];

        require(stake.id == _stakeId, "Stake with this id does not exist");
        require(stake.amount > 0, "Stake is empty");
        require(stake.tokensUnlockTime <= block.timestamp || stake.stakeMultiplierPercent == 0, "Can't restake before the unlock time");

        uint256 newStakeMultiplier = getStakeMultiplierPercent(_stakeDays);
        stake.tokensUnlockTime = block.timestamp.add(_stakeDays.mul(1 days));
        stake.stakeMultiplierPercent = newStakeMultiplier;

        emit Restake(msg.sender, _pid, _stakeId, stake.tokensUnlockTime);
    }

    // Function to compound earnings into deposit
    function compound(uint256 _pid, uint256 _stakeId) public onlyOperating {
        require(_pid == 0, "Can only compound in the primary pool (_pid == 0)");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "Stake with this id does not exist");

        require(stake.amount > 0, "User does not have anything staked");

        // Update pool
        updatePool(_pid);

        // Compute compounding amount
        uint256 pendingAmount = stake.amount.mul(pool.accERC20PerShare).div(1e36).sub(stake.rewardDebt);
        uint256 fee = pendingAmount.mul(depositFeePercent).div(depositFeePrecision);
        uint256 amountCompounding = pendingAmount.sub(fee);

        require(amountCompounding > 0, "Nothing to compound yet");

        uint256 feePoolShare = fee.mul(depositFeePoolSharePercent).div(100);
        depositFeeCollected = depositFeeCollected.add(fee.sub(feePoolShare));

        // Update accounting around burns
        burnFromUser(msg.sender, feePoolShare);
        emit FeeTaken(msg.sender, _pid, fee, feePoolShare);
        // Update pool including fee for people currently staking
        updatePoolWithFee(_pid, feePoolShare);

        // Mint the tokens to the contract address, because we consider it a stake
        distribution.mintTokens(address(this), pendingAmount);

        // Increase amount user is staking
        stake.amount = stake.amount.add(amountCompounding);
        stake.rewardDebt = stake.amount.mul(pool.accERC20PerShare).div(1e36);

        // Update user's total amount
        user.totalAmount = user.totalAmount.add(amountCompounding);

        // Increase pool's total deposits
        pool.totalDeposits = pool.totalDeposits.add(amountCompounding);
        emit CompoundedEarnings(msg.sender, _pid, _stakeId, amountCompounding, stake.amount);
    }

    // Transfer ERC20 and update the required ERC20 to payout all rewards
    function erc20MintAndTransfer(address _to, uint256 _amount) internal {
        uint256 erc20Balance = erc20.balanceOf(address(this)).sub(depositFeeCollected).sub(poolInfo[0].totalDeposits);
        if (_amount > erc20Balance) {
            distribution.mintTokens(address(this), _amount.sub(erc20Balance));
        }
        erc20.transfer(_to, _amount);
        paidOut += _amount;
    }

    // Internal function to burn amount from user and do accounting
    function burnFromUser(address user, uint256 amount) internal {
        totalBurnedFromUser[user] = totalBurnedFromUser[user].add(amount);
        totalAvatRedistributed = totalAvatRedistributed.add(amount);
    }

    // Function to fetch deposits and earnings at one call for multiple users for passed pool id.
    function getTotalPendingAndDepositedForUsers(address[] memory users, uint256 pid) external view returns (uint256[] memory, uint256[] memory) {
        uint256[] memory deposits = new uint256[](users.length);
        uint256[] memory earnings = new uint256[](users.length);

        // Get deposits and earnings for selected users
        for (uint256 i = 0; i < users.length; i++) {
            UserInfo storage user = userInfo[pid][users[i]];

            deposits[i] = totalDeposited(pid, users[i]);
            // Sum for all user's stakes
            for (uint256 j = 0; j < user.stakeIds.length; j++) {
                earnings[i] = earnings[i].add(pending(pid, users[i], user.stakeIds[j]));
            }
        }

        return (deposits, earnings);
    }

    // Mint reward that was not paid out when pool was empty
    function emergencyMint(address _recipient) external onlyOwner {
        uint256 amount = missedRewards.sub(missedRewardsMinted);
        require(amount > 0, "There are no missed rewards for minting");

        distribution.mintTokens(_recipient, amount);
        missedRewardsMinted = missedRewardsMinted.add(amount);

        emit EmergencyMint(_recipient, amount);
    }

    // Function to set admin contract by owner
    function setAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Cannot set zero address as admin.");
        admin = IAdmin(_admin);
    }

    // Halt contract's operations
    function halt() external onlyOwner {
        contractState = ContractState.Halted;
    }

    // Resume contract's operation
    function resume() external onlyOwner {
        contractState = ContractState.Operating;
    }
}
