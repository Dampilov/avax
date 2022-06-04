// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "./interfaces/IAdmin.sol";
import "./interfaces/IDistribution.sol";

contract AVAXStaking is OwnableUpgradeable, PausableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct StakeRecord {
        uint256 id; // Stake id, NOT UNIQUE OVER ALL USERS, unique only among user's other stakes.
        uint256 index; // Index of the StakeRecord in the user.stakeIds array.
        uint256 amount; // Stake amount
        uint256 rewardDebt; // Current reward debt.
        uint256 tokensUnlockTime; // When stake tokens will unlock
    }

    struct UserInfo {
        uint256 totalAmount; // How many LP tokens the user has provided in all his stakes.
        uint256 totalRewarded; // How many tokens user got rewarded in total
        uint256 stakesCount; // How many new deposits user made overall
        uint256[] stakeIds; // User's current (not fully withdrawn) stakes ids
        mapping(uint256 => StakeRecord) stakes; // Stake's id to the StakeRecord mapping
    }

    struct PoolInfo {
        IERC20Upgradeable depositToken; // Address of ERC20 deposit token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. ERC20s to distribute per block.
        uint256 accTokenPerShare; // Accumulated ERC20s per share, times 1e36.
        uint256 totalDeposits; // Total amount of tokens deposited at the moment (staked)
        uint256 depositFeePercent; // Percent of deposit fee, must be >= depositFeePrecision / 100 and less than depositFeePrecision
        uint256 depositFeeCollected; // Amount of the deposit fee collected and ready to claim by the owner
        uint256 tokenBlockTime; // Token block time in seconds
        uint256 uniqueUsers; // How many unique users there are in the pool
    }

    // Deposit fee precision for math calculations
    uint256 public DEPOSIT_FEE_PRECISION;

    // Acc reward per share precision in ^36
    uint256 public ACC_REWARD_PER_SHARE_PRECISION;

    // WAVAX address
    IERC20Upgradeable public wavax;

    // Last reward balance of WAVAX tokens
    uint256 public lastRewardBalance;

    // The total amount of ERC20 that's paid out as reward
    uint256 public paidOut;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;

    event Deposit(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 withdrawAmount, uint256 rewardAmount);
    event Collect(address indexed user, uint256 indexed pid, uint256 indexed stakeIndex, uint256 amount);
    event SetDepositFee(uint256 depositFeePercent);
    event ClaimCollectedFees(uint amount);

    function initialize(
        IERC20Upgradeable _wavax,
        uint _depositFeePrecision
    ) public initializer {
        __Ownable_init();
        __Pausable_init();

        ACC_REWARD_PER_SHARE_PRECISION = 1e36;

        require(_depositFeePrecision >= 100, "I0");
        DEPOSIT_FEE_PRECISION = _depositFeePrecision;

        require(address(_wavax)  != address(0x0), "I1");
        wavax = _wavax;
    }

    /**
     * @notice Add a new pool. Can only be called by the owner.
     * @dev DO NOT add the same LP token more than once. Rewards will be messed up if you do.
     */
    function add(
        IERC20Upgradeable _depositToken,
        uint256 _allocPoint,
        uint256 _depositFeePercent,
        uint256 _tokenBlockTime,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }

        totalAllocPoint = totalAllocPoint + _allocPoint;
        poolInfo.push(PoolInfo({depositToken: _depositToken, allocPoint: _allocPoint, accTokenPerShare: 0, totalDeposits: 0, uniqueUsers: 0, depositFeePercent: _depositFeePercent, depositFeeCollected: 0, tokenBlockTime: _tokenBlockTime}));
    }

    /**
     * @notice Deposit tokens
     */
    function deposit(
        uint256 _pid,
        uint256 _amount
    ) public whenNotPaused {
        require(_amount > 0, "D0");
        require(_pid < poolInfo.length, "D1");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        uint256 depositAmount = _amount;

        uint256 depositFee = _amount * pool.depositFeePercent / DEPOSIT_FEE_PRECISION;
        depositAmount = _amount - depositFee;

        pool.depositFeeCollected = pool.depositFeeCollected + depositAmount;

        // Update pool including fee for people staking
        updatePool(_pid);
        
        // Add deposit to total deposits
        pool.totalDeposits = pool.totalDeposits + depositAmount;

        // Increment if this is a new user of the pool
        if (user.stakesCount == 0) {
            pool.uniqueUsers = pool.uniqueUsers + 1;
        }

        // Initialize a new stake record
        uint256 stakeId = user.stakesCount;
        require(user.stakes[stakeId].id == 0, "D2");

        StakeRecord storage stake = user.stakes[stakeId];
        // Set stake id
        stake.id = stakeId;
        // Set stake index in the user.stakeIds array
        stake.index = user.stakeIds.length;
        // Add deposit to user's amount
        stake.amount = depositAmount;
        // Update user's total amount
        user.totalAmount = user.totalAmount + depositAmount;
        // Compute reward debt
        stake.rewardDebt = stake.amount * pool.accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION;
        // Set lockup time
        stake.tokensUnlockTime = block.timestamp + pool.tokenBlockTime;

        // Push user's stake id
        user.stakeIds.push(stakeId);
        // Increase users's overall stakes count
        user.stakesCount = user.stakesCount + 1;

        // Safe transfer deposit tokens from user
        pool.depositToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        emit Deposit(msg.sender, _pid, stake.id, depositAmount);
    }

    /**
     * @notice Withdraw deposit tokens and collect staking rewards in WAVAX from pool
     */
    function withdraw(uint256 _pid, uint256 _stakeId) public whenNotPaused {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        uint256 amount = stake.amount;

        require(stake.tokensUnlockTime <= block.timestamp, "W0");
        require(amount > 0, "W1");

        // Update pool
        updatePool(_pid);

        // Compute user's pending amount
        uint256 pendingAmount = stake.amount * pool.accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;

        // Transfer pending amount to user
        _safeTransferReward(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded + pendingAmount;
        user.totalAmount = user.totalAmount - amount;

        stake.amount = 0;
        stake.rewardDebt = stake.amount * pool.accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION;

        // Transfer withdrawal amount to user (with fee being withdrawalFeeDepositAmount)
        pool.depositToken.safeTransfer(address(msg.sender), amount);
        pool.totalDeposits = pool.totalDeposits - amount;

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

    /**
     * @notice Collect staking rewards in WAVAX
     */
    function collect(uint256 _pid, uint256 _stakeId) public whenNotPaused {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.amount > 0, "C0");

        // Update pool
        updatePool(_pid);

        // Compute user's pending amount
        uint256 pendingAmount = stake.amount * pool.accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;

        // Transfer pending amount to user
        _safeTransferReward(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded + pendingAmount;
        stake.rewardDebt = stake.amount * pool.accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION;

        emit Collect(msg.sender, _pid, _stakeId, pendingAmount);
    }

    /**
     * @notice Set deposit fee for particular pool
     */
    function setDepositFee(uint256 _pid, uint256 _depositFeePercent) external onlyOwner {
        PoolInfo storage pool = poolInfo[_pid];

        require(_depositFeePercent <= DEPOSIT_FEE_PRECISION);
        pool.depositFeePercent = _depositFeePercent;

        emit SetDepositFee(_depositFeePercent);
    }

    /**
     * @notice Claim all collected fees and send them to the recipient. Can only be called by the owner.
     * 
     * @param _pid pool id
     * @param _recipient address which receives collected fees
     */
    function claimCollectedFees(uint256 _pid, address _recipient) external onlyOwner {
        PoolInfo storage pool = poolInfo[_pid];

        uint amountToCollect = pool.depositFeeCollected;
        pool.depositFeeCollected = 0;
        
        pool.depositToken.transfer(_recipient, amountToCollect);
        emit ClaimCollectedFees(amountToCollect);
    }

    /**
     * @notice Update the given pool's ERC20 allocation point. Can only be called by the owner. 
     * Always prefer to call with _withUpdate set to true.
     */
    function setAllocation(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    /**
     * @notice Get user's stakes count
     */
    function userStakesCount(uint256 _pid, address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.stakeIds.length;
    }

    /**
     * @notice Get pool info
     */
    function getPool(uint256 _pid) public view returns (PoolInfo memory) {
        return poolInfo[_pid];
    }

    /**
     * @notice Return user's stakes array
     */
    function getUserStakes(uint256 _pid, address _user) public view returns (StakeRecord[] memory stakeArray) {
        UserInfo storage user = userInfo[_pid][_user];
        stakeArray = new StakeRecord[](user.stakeIds.length);
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            stakeArray[i] = user.stakes[user.stakeIds[i]];
        }
    }

    /**
     * @notice Return user's specific stake
     */
    function getUserStake(
        uint256 _pid,
        address _user,
        uint256 _stakeId
    ) public view returns (StakeRecord memory) {
        UserInfo storage user = userInfo[_pid][_user];
        require(user.stakes[_stakeId].id == _stakeId, "Stake with this id does not exist");
        return user.stakes[_stakeId];
    }

    /**
     * @notice Return user's stake ids array
     */
    function getUserStakeIds(uint256 _pid, address _user) public view returns (uint256[] memory) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.stakeIds;
    }

    /**
     * @notice View function to see deposited tokens for a particular user's stake.
     */
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

    /**
     * @notice View function to see pending rewards for a user's stake.
     */
    function pending(
        uint256 _pid,
        address _user,
        uint256 _stakeId
    ) public view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "P0");

        uint256 depositTokenSupply = pool.totalDeposits;
        uint256 currentRewardBalance = wavax.balanceOf(address(this));

        uint256 _accTokenPerShare = pool.accTokenPerShare;

        if (currentRewardBalance != lastRewardBalance && depositTokenSupply != 0) {
            uint256 _accruedReward = currentRewardBalance - lastRewardBalance;
            _accTokenPerShare = _accTokenPerShare + 
                _accruedReward * pool.allocPoint / totalAllocPoint * ACC_REWARD_PER_SHARE_PRECISION / depositTokenSupply;
        }

        return stake.amount * _accTokenPerShare / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;
    }

    /**
     * @notice Number of pools
     */
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @notice Number of pools
     */
    function totalPending(uint256 _pid, address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];

        uint256 pendingAmount = 0;
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            pendingAmount = pendingAmount + pending(_pid, _user, user.stakeIds[i]);
        }
        return pendingAmount;
    }

    /**
     * @notice Update reward variables for all pools. Be careful of gas spending!
     */
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /**
     * @notice Update pool rewards. Needs to be called before any deposit or withdrawal
     *
     * @param _pid pool id
     */
    function updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];

        uint256 depositTokenSupply = pool.totalDeposits;
        uint256 currentRewardBalance = wavax.balanceOf(address(this));

        if (depositTokenSupply == 0 || currentRewardBalance == lastRewardBalance) {
            return;
        }

        uint256 _accruedReward = currentRewardBalance - lastRewardBalance;

        pool.accTokenPerShare = pool.accTokenPerShare + 
            _accruedReward * pool.allocPoint / totalAllocPoint * ACC_REWARD_PER_SHARE_PRECISION / depositTokenSupply;

        lastRewardBalance = currentRewardBalance;
    }

    /**
     * @notice Transfer rewards and update lastRewardBalance
     *
     * @param _to user address
     * @param _amount pending reward amount
     */
    function _safeTransferReward(address _to, uint256 _amount) internal {
        uint256 wavaxBalance = wavax.balanceOf(address(this));

        if (_amount > wavaxBalance) {
            lastRewardBalance = lastRewardBalance - wavaxBalance;
            paidOut += wavaxBalance;

            wavax.safeTransfer(_to, wavaxBalance);
        } else {
            lastRewardBalance = lastRewardBalance - wavaxBalance;
            paidOut += _amount;

            wavax.safeTransfer(_to, _amount);
        }
    }
}
