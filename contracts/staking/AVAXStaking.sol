// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "./interfaces/IWAVAX.sol";
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

    /// @notice Address of ERC20 deposit token contract.
    IERC20Upgradeable public depositToken; 

    /// @notice Accumulated ERC20s per share, times 1e36.
    uint256 accTokenPerShare;

    /// @notice Total amount of tokens deposited at the moment (staked)
    uint256 totalDeposits;

    /// @notice Percent of deposit fee, must be >= depositFeePrecision / 100 and less than depositFeePrecision
    uint256 depositFeePercent; 

    /// @notice Amount of the deposit fee collected and ready to claim by the owner
    uint256 depositFeeCollected;

    /// @notice Token block time in seconds
    uint256 tokenBlockTime; 

    /// @notice How many unique users there are in the pool
    uint256 uniqueUsers; 

    /// @notice Deposit fee precision for math calculations
    uint256 public DEPOSIT_FEE_PRECISION;

    /// @notice Acc reward per share precision in ^36
    uint256 public constant ACC_REWARD_PER_SHARE_PRECISION = 1e36;

    /// @notice WAVAX address
    IWAVAX public wavax;

    /// @notice Last reward balance of WAVAX tokens
    uint256 public lastRewardBalance;

    /// @notice The total amount of ERC20 that's paid out as reward
    uint256 public paidOut;

    /// @notice Info of each user that stakes LP tokens.
    mapping(address => UserInfo) public userInfo;

    event Deposit(address indexed user, uint256 indexed stakeIndex, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed stakeIndex, uint256 withdrawAmount, uint256 rewardAmount);
    event Collect(address indexed user, uint256 indexed stakeIndex, uint256 amount);
    event SetDepositFee(uint256 depositFeePercent);
    event ClaimCollectedFees(uint256 amount);

    function initialize(
        IWAVAX _wavax,
        IERC20Upgradeable _depositToken,
        uint256 _depositFeePrecision,
        uint256 _depositFeePercent,
        uint256 _tokenBlockTime
    ) public initializer {
        __Ownable_init();
        __Pausable_init();

        require(_depositFeePrecision >= 100, "I0");
        DEPOSIT_FEE_PRECISION = _depositFeePrecision;
        depositFeePercent = _depositFeePercent;

        require(address(_wavax) != address(0x0), "I1");
        wavax = _wavax;

        depositToken = IERC20Upgradeable(_depositToken);
        tokenBlockTime = _tokenBlockTime;
    }

    receive() external payable {
        assert(msg.sender == address(wavax)); // only accept AVAX via fallback from the WAVAX contract
    }

    /**
     * @notice Deposit tokens
     */
    function deposit(uint256 _amount) public whenNotPaused {
        require(_amount > 0, "D0");

        UserInfo storage user = userInfo[msg.sender];

        uint256 depositAmount = _amount;

        uint256 depositFee = (_amount * depositFeePercent) / DEPOSIT_FEE_PRECISION;
        depositAmount = _amount - depositFee;

        depositFeeCollected = depositFeeCollected + depositAmount;

        // Update pool including fee for people staking
        updatePool();

        // Add deposit to total deposits
        totalDeposits = totalDeposits + depositAmount;

        // Increment if this is a new user of the pool
        if (user.stakesCount == 0) {
            uniqueUsers = uniqueUsers + 1;
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
        stake.rewardDebt = (stake.amount * accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION;
        // Set lockup time
        stake.tokensUnlockTime = block.timestamp + tokenBlockTime;

        // Push user's stake id
        user.stakeIds.push(stakeId);
        // Increase users's overall stakes count
        user.stakesCount = user.stakesCount + 1;

        // Safe transfer deposit tokens from user
        depositToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        emit Deposit(msg.sender, stake.id, depositAmount);
    }

    /**
     * @notice Withdraw deposit tokens and collect staking rewards in WAVAX from pool
     */
    function withdraw(uint256 _stakeId) public whenNotPaused {
        UserInfo storage user = userInfo[msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        uint256 amount = stake.amount;

        require(stake.tokensUnlockTime <= block.timestamp, "W0");
        require(amount > 0, "W1");

        // Update pool
        updatePool();

        // Compute user's pending amount
        uint256 pendingAmount = (stake.amount * accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;

        // Transfer pending amount to user
        _safeTransferReward(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded + pendingAmount;
        user.totalAmount = user.totalAmount - amount;

        stake.amount = 0;
        stake.rewardDebt = (stake.amount * accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION;

        depositToken.safeTransfer(address(msg.sender), amount);
        totalDeposits = totalDeposits - amount;

        // Clean stake data since it's always a full withdraw
        {
            uint256 lastStakeId = user.stakeIds[user.stakeIds.length - 1];

            user.stakeIds[stake.index] = lastStakeId;
            user.stakeIds.pop();
            user.stakes[lastStakeId].index = stake.index;

            delete user.stakes[stake.id];
        }

        emit Withdraw(msg.sender, _stakeId, amount, pendingAmount);
    }

    /**
     * @notice Collect staking rewards in WAVAX
     */
    function collect(uint256 _stakeId) public whenNotPaused {
        UserInfo storage user = userInfo[msg.sender];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.amount > 0, "C0");

        // Update pool
        updatePool();

        // Compute user's pending amount
        uint256 pendingAmount = (stake.amount * accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;

        // Transfer pending amount to user
        _safeTransferReward(msg.sender, pendingAmount);
        user.totalRewarded = user.totalRewarded + pendingAmount;
        stake.rewardDebt = (stake.amount * accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION;

        emit Collect(msg.sender, _stakeId, pendingAmount);
    }

    /**
     * @notice Set deposit fee for particular pool
     */
    function setDepositFee(uint256 _depositFeePercent) external onlyOwner {
        require(_depositFeePercent <= DEPOSIT_FEE_PRECISION);
        depositFeePercent = _depositFeePercent;

        emit SetDepositFee(_depositFeePercent);
    }

    /**
     * @notice Claim all collected fees and send them to the recipient. Can only be called by the owner.
     *
     * @param _recipient address which receives collected fees
     */
    function claimCollectedFees(address _recipient) external onlyOwner {
        uint256 amountToCollect = depositFeeCollected;
        depositFeeCollected = 0;

        depositToken.transfer(_recipient, amountToCollect);
        emit ClaimCollectedFees(amountToCollect);
    }

    /**
     * @notice Get user's stakes count
     */
    function userStakesCount(address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        return user.stakeIds.length;
    }

    /**
     * @notice Return user's stakes array
     */
    function getUserStakes(address _user) public view returns (StakeRecord[] memory stakeArray) {
        UserInfo storage user = userInfo[_user];
        stakeArray = new StakeRecord[](user.stakeIds.length);
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            stakeArray[i] = user.stakes[user.stakeIds[i]];
        }
    }

    /**
     * @notice Return user's specific stake
     */
    function getUserStake(
        address _user,
        uint256 _stakeId
    ) public view returns (StakeRecord memory) {
        UserInfo storage user = userInfo[_user];
        require(user.stakes[_stakeId].id == _stakeId, "Stake with this id does not exist");
        return user.stakes[_stakeId];
    }

    /**
     * @notice Return user's stake ids array
     */
    function getUserStakeIds(address _user) public view returns (uint256[] memory) {
        UserInfo storage user = userInfo[_user];
        return user.stakeIds;
    }

    /**
     * @notice View function to see deposited tokens for a particular user's stake.
     */
    function deposited(
        address _user,
        uint256 _stakeId
    ) public view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "Stake with this id does not exist");
        return stake.amount;
    }

    // View function to see total deposited LP for a user.
    function totalDeposited(address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        return user.totalAmount;
    }

    /**
     * @notice View function to see pending rewards for a user's stake.
     */
    function pending(
        address _user,
        uint256 _stakeId
    ) public view returns (uint256) {
        UserInfo storage user = userInfo[_user];

        StakeRecord storage stake = user.stakes[_stakeId];
        require(stake.id == _stakeId, "P0");

        uint256 depositTokenSupply = totalDeposits;
        uint256 currentRewardBalance = wavax.balanceOf(address(this));

        uint256 _accTokenPerShare = accTokenPerShare;

        if (currentRewardBalance != lastRewardBalance && depositTokenSupply != 0) {
            uint256 _accruedReward = currentRewardBalance - lastRewardBalance;
            _accTokenPerShare = _accTokenPerShare + (_accruedReward * ACC_REWARD_PER_SHARE_PRECISION) / depositTokenSupply;
        }

        return (stake.amount * _accTokenPerShare) / ACC_REWARD_PER_SHARE_PRECISION - stake.rewardDebt;
    }

    /**
     * @notice Number of pools
     */
    function totalPending(address _user) public view returns (uint256) {
        UserInfo storage user = userInfo[_user];

        uint256 pendingAmount = 0;
        for (uint256 i = 0; i < user.stakeIds.length; i++) {
            pendingAmount = pendingAmount + pending(_user, user.stakeIds[i]);
        }
        return pendingAmount;
    }

    /**
     * @notice Update pool rewards. Needs to be called before any deposit or withdrawal
     */
    function updatePool() public {
        uint256 depositTokenSupply = totalDeposits;
        uint256 currentRewardBalance = wavax.balanceOf(address(this));

        if (depositTokenSupply == 0 || currentRewardBalance == lastRewardBalance) {
            return;
        }

        uint256 _accruedReward = currentRewardBalance - lastRewardBalance;

        accTokenPerShare = accTokenPerShare + (_accruedReward * ACC_REWARD_PER_SHARE_PRECISION) / depositTokenSupply;

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

            wavax.withdraw(wavaxBalance);
            payable(_to).transfer(wavaxBalance);
        } else {
            lastRewardBalance = lastRewardBalance - wavaxBalance;
            paidOut += _amount;

            wavax.withdraw(_amount);
            payable(_to).transfer(_amount);
        }
    }
}
