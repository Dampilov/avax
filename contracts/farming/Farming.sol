// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IFarmingFactory.sol";

contract Farming is OwnableUpgradeable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice Info of each user.
    struct UserInfo {
        uint256 amount;
        uint256 rewardAvatTokenDebt;
        uint256 rewardBonusTokenDebt;
    }

    /* CONTRACTS */

    /// @notice AVAT reward token contract
    IERC20Upgradeable public avatToken;

    /// @notice Bonus reward token contract
    IERC20Upgradeable public bonusToken;

    /// @notice LP token contract
    IERC20Upgradeable public lpToken;

    /// @notice Farming factory contract
    IFarmingFactory public farmingFactory;

    /* POOL INFO */

    /// @notice Last timestamp that AVAT distribution occurs
    uint256 public lastRewardTimestamp;

    /// @notice Accumulated AVAT tokens per share
    uint256 public accAvatTokenPerShare;

    /// @notice Accumulated bonus tokens per share
    uint256 public accBonusTokenPerShare;

    /// @notice How many tokens are being distributed per sec
    uint256 public bonusTokenPerSec;

    /* OTHER */

    /// @notice User info
    mapping(address => UserInfo) public userInfo;

    /// @notice Accumulated token per share precision
    uint256 public constant ATPS_PRECISION = 1e36;

    /// @notice Fee percent equals 0.5%
    uint256 public constant REWARDS_FEE = 995;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event UpdatePool(uint256 lastRewardTimestamp, uint256 lpSupply, uint256 accBonusTokenPerShare, uint256 accAvatTokenPerShare);
    event Harvest(address indexed user, uint256 amountAvat, uint256 amountBonus);
    event EmergencyWithdraw(address indexed user, uint256 amount);

    /**
     * @notice Initialize farming contract
     * NOTE: You can pass 0x0 address for avatToken_ or bonusToken_ to disable these rewards
     *
     * @param owner_ owner address
     * @param avatToken_ AVAT token address
     * @param lpToken_ LP token address
     * @param bonusToken_ Bonus (ERC20) token address
     * @param bonusTokenPerSec_ Bonus token per sec distribution
     * @param startTimestamp_ When farming pool will start
     */
    function initialize(
        address owner_,
        address avatToken_,
        address lpToken_,
        address bonusToken_,
        uint256 bonusTokenPerSec_,
        uint256 startTimestamp_
    ) public initializer {
        __Ownable_init();
        transferOwnership(owner_);

        require(lpToken_ != address(0x0), "I0");
        lpToken = IERC20Upgradeable(lpToken_);

        farmingFactory = IFarmingFactory(msg.sender);
        avatToken = IERC20Upgradeable(avatToken_);
        bonusToken = IERC20Upgradeable(bonusToken_);

        bonusTokenPerSec = bonusTokenPerSec_;
        lastRewardTimestamp = block.timestamp > startTimestamp_ ? block.timestamp : startTimestamp_;
    }

    /**
     * @notice View function to see user pending tokens
     *
     * @param _user user address
     */
    function pending(address _user) public view returns (uint256 pendingAvat, uint256 pendingBonus) {
        UserInfo storage user = userInfo[_user];
        uint256 lpSupply = lpToken.balanceOf(address(this));

        if (address(bonusToken) != address(0)) {
            uint256 accTokenPerShare = accBonusTokenPerShare;

            if (block.timestamp > lastRewardTimestamp && lpSupply != 0) {
                uint256 multiplier = block.timestamp.sub(lastRewardTimestamp);
                uint256 reward = multiplier.mul(bonusTokenPerSec);
                accTokenPerShare = accTokenPerShare.add(reward.mul(ATPS_PRECISION).div(lpSupply));
            }

            pendingBonus = user.amount.mul(accTokenPerShare).div(ATPS_PRECISION).sub(user.rewardBonusTokenDebt);
        }

        if (address(avatToken) != address(0)) {
            uint256 accTokenPerShare = accAvatTokenPerShare;

            if (block.timestamp > lastRewardTimestamp && lpSupply != 0) {
                uint256 reward = farmingFactory.countRewardAmount(lastRewardTimestamp, block.timestamp, address(this));
                accTokenPerShare = accTokenPerShare.add(reward.mul(ATPS_PRECISION).div(lpSupply));
            }

            pendingAvat = user.amount.mul(accTokenPerShare).div(ATPS_PRECISION).sub(user.rewardAvatTokenDebt);
        }
    }

    /**
     * @notice Function to deposit LP tokens
     *
     * @param _amount amount of LP tokens
     */
    function deposit(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        updatePool();

        // gas saving
        uint256 _userAmount = user.amount;

        if (_userAmount > 0) {
            uint256 pendingAvat = _userAmount.mul(accAvatTokenPerShare).div(ATPS_PRECISION).sub(user.rewardAvatTokenDebt);
            uint256 pendingBonus = _userAmount.mul(accBonusTokenPerShare).div(ATPS_PRECISION).sub(user.rewardBonusTokenDebt);
            _harvest(pendingAvat, pendingBonus);
        }

        user.amount = _userAmount.add(_amount);
        user.rewardAvatTokenDebt = user.amount.mul(accAvatTokenPerShare).div(ATPS_PRECISION);
        user.rewardBonusTokenDebt = user.amount.mul(accBonusTokenPerShare).div(ATPS_PRECISION);

        lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        emit Deposit(msg.sender, _amount);
    }

    /**
     * @notice Function to withdraw LP tokens
     *
     * @param _amount amount of LP tokens
     */
    function withdraw(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        // gas saving
        uint256 _userAmount = user.amount;
        require(_userAmount >= _amount, "W0");

        updatePool();

        uint256 pendingAvat = _userAmount.mul(accAvatTokenPerShare).div(ATPS_PRECISION).sub(user.rewardAvatTokenDebt);
        uint256 pendingBonus = _userAmount.mul(accBonusTokenPerShare).div(ATPS_PRECISION).sub(user.rewardBonusTokenDebt);
        _harvest(pendingAvat, pendingBonus);

        user.amount = _userAmount.sub(_amount);
        user.rewardAvatTokenDebt = user.amount.mul(accAvatTokenPerShare).div(ATPS_PRECISION);
        user.rewardBonusTokenDebt = user.amount.mul(accBonusTokenPerShare).div(ATPS_PRECISION);

        lpToken.safeTransfer(address(msg.sender), _amount);
        emit Withdraw(msg.sender, _amount);
    }

    /**
     * @notice Withdraw without caring about rewards. EMERGENCY ONLY.
     */
    function emergencyWithdraw() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        lpToken.safeTransfer(address(msg.sender), user.amount);

        user.amount = 0;
        user.rewardAvatTokenDebt = 0;
        user.rewardBonusTokenDebt = 0;

        emit EmergencyWithdraw(msg.sender, user.amount);
    }

    /**
     * @notice Harvest AVAT and/or Bonus rewards and take fee
     */
    function _harvest(uint256 pendingAvat, uint256 pendingBonus) internal {
        if (pendingAvat != 0) {
            uint256 senderAmount = (pendingAvat * REWARDS_FEE) / 1000;

            farmingFactory.mintTokens(msg.sender, senderAmount);
            farmingFactory.mintTokens(address(farmingFactory), pendingAvat - senderAmount);
        }

        if (pendingBonus != 0) {
            _safeTransfer(bonusToken, msg.sender, pendingBonus);
        }

        emit Harvest(msg.sender, pendingAvat, pendingBonus);
    }

    function _safeTransfer(
        IERC20Upgradeable token_,
        address to_,
        uint256 amount_
    ) internal {
        uint256 balance = token_.balanceOf(address(this));

        if (amount_ > balance) {
            uint256 senderAmount = (balance * REWARDS_FEE) / 1000;

            token_.safeTransfer(to_, senderAmount);
            token_.safeTransfer(address(farmingFactory), balance - senderAmount);
        } else {
            uint256 senderAmount = (amount_ * REWARDS_FEE) / 1000;

            token_.safeTransfer(to_, senderAmount);
            token_.safeTransfer(address(farmingFactory), amount_ - senderAmount);
        }
    }

    /**
     * @notice Update pool info. Public function
     */
    function updatePool() public {
        if (block.timestamp <= lastRewardTimestamp) {
            return;
        }

        uint256 lpSupply = lpToken.balanceOf(address(this));

        if (lpSupply == 0) {
            lastRewardTimestamp = block.timestamp;
            return;
        }

        uint256 multiplier = block.timestamp.sub(lastRewardTimestamp);
        uint256 bonusReward = multiplier.mul(bonusTokenPerSec);
        accBonusTokenPerShare = accBonusTokenPerShare.add(bonusReward.mul(ATPS_PRECISION).div(lpSupply));

        uint256 reward = farmingFactory.countRewardAmount(lastRewardTimestamp, block.timestamp, address(this));
        accAvatTokenPerShare = accAvatTokenPerShare.add(reward.mul(ATPS_PRECISION).div(lpSupply));

        lastRewardTimestamp = block.timestamp;
        emit UpdatePool(lastRewardTimestamp, lpSupply, accBonusTokenPerShare, accAvatTokenPerShare);
    }
}
