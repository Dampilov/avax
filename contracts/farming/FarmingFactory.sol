// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./Farming.sol";

import "./library/OwnableTimelock.sol";
import "./interfaces/IDistributionV2.sol";

contract FarmingFactory is OwnableTimelock {
    using SafeMath for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice OpenZeppelin clones implementation
    address immutable farmingImplementation;

    /// @notice AVAT token contract
    IERC20Upgradeable public immutable avatToken;

    /// @notice DistributionV2 contract
    IDistributionV2 public distributionV2;

    /// @notice Useful variable to check trust farmings
    mapping(address => bool) public isFarmingCreatedThroughFactory;

    /// @notice Farming allocation point
    mapping(address => uint256) public farmingAllocationPoint;

    /// @notice Farming allocation point
    uint256 public totalFarmingAllocationPoint;

    /// @notice Allocation point precision
    uint256 public AP_PRECISION = 1e12;

    /// @notice Expose so query can be possible only by position as well
    address[] public allFarmings;

    event DeployFarming(address indexed farmingAddress, address avatToken, address indexed lpToken, address indexed bonusToken, uint256 bonusTokenAmount, uint256 bonusTokenPerSec, uint256 startTimestamp);
    event UpdateDistributionV2Address(address indexed newAddress);
    event UpdateFarmingAllocationPoint(address indexed farmingAddress, uint256 allocationPoint);
    event MintTokens(address indexed to, uint256 amount);
    event CollectFee(address indexed token, address indexed to, uint256 amount);

    constructor(address avatToken_, address distributionV2_) {
        farmingImplementation = address(new Farming());

        require(avatToken_ != address(0x0), "C0");
        avatToken = IERC20Upgradeable(avatToken_);

        require(distributionV2_ != address(0x0), "C1");
        distributionV2 = IDistributionV2(distributionV2_);
    }

    /**
     * @notice [OWNER ONLY] Deploy new farming
     *
     * @param lpToken_ LP token address
     * @param bonusToken_ Bonus (ERC20) token address
     * @param bonusTokenPerSec_ Bonus token per sec distribution
     * @param avatReward_ If AVAT token rewards enabled
     * @param startTimestamp_ When farming pool will start
     */
    function deployFarming(
        address lpToken_,
        address bonusToken_,
        uint256 bonusTokenAmount_,
        uint256 bonusTokenPerSec_,
        bool avatReward_,
        uint256 startTimestamp_,
        uint256 allocationPoint_
    ) external onlyOwner returns (address) {
        require(!(!avatReward_ && bonusToken_ == address(0x0)), "Specify at least one reward");
        require(!(!avatReward_ && allocationPoint_ > 0), "Farming cannot have allocation without avat reward");

        address clone = Clones.clone(farmingImplementation);
        address avatAddress = avatReward_ == true ? address(avatToken) : address(0x0);

        if (bonusToken_ != address(0x0)) {
            IERC20Upgradeable(bonusToken_).safeTransferFrom(msg.sender, clone, bonusTokenAmount_);
        }

        Farming(clone).initialize(msg.sender, avatAddress, lpToken_, bonusToken_, bonusTokenPerSec_, startTimestamp_);

        isFarmingCreatedThroughFactory[clone] = true;
        farmingAllocationPoint[clone] = allocationPoint_;
        totalFarmingAllocationPoint = totalFarmingAllocationPoint.add(allocationPoint_);
        allFarmings.push(clone);

        emit DeployFarming(clone, avatAddress, lpToken_, bonusToken_, bonusTokenAmount_, bonusTokenPerSec_, startTimestamp_);
        return clone;
    }

    /**
     * @notice [FARMING CONTRACTS ONLY] Mint AVAT tokens.
     * NOTE: To mintTokens FarmingFactory need to be admin of DistributionV2
     * Execute this function can only contract that created through factory
     */
    function mintTokens(address to, uint256 amount) external {
        require(isFarmingCreatedThroughFactory[msg.sender], "MT0");

        distributionV2.mintTokens(to, amount);
        emit MintTokens(to, amount);
    }

    /**
     * @notice [OWNER ONLY] Collect fee from farmings.
     */
    function collectFee(address token_, address to_) external onlyOwner {
        uint256 amount = IERC20Upgradeable(token_).balanceOf(address(this));

        IERC20Upgradeable(token_).safeTransfer(to_, amount);
        emit CollectFee(token_, to_, amount);
    }

    /**
     * @notice Count AVAT reward amount
     */
    function countRewardAmount(
        uint256 start_,
        uint256 end_,
        address farmingAddress
    ) external view returns (uint256) {
        if (totalFarmingAllocationPoint == 0) {
            return 0;
        }

        uint256 reward = distributionV2.countRewardAmount(start_, end_);
        uint256 farmingReward = reward.mul(farmingAllocationPoint[farmingAddress]).div(totalFarmingAllocationPoint);

        return farmingReward;
    }

    /**
     * @notice [OWNER ONLY] Update farming contract allocation point
     */
    function updateFarmingAllocationPoint(address farmingAddress_, uint256 allocationPoint_) external onlyOwner {
        require(isFarmingCreatedThroughFactory[farmingAddress_], "UFAP0");

        totalFarmingAllocationPoint = totalFarmingAllocationPoint.sub(farmingAllocationPoint[farmingAddress_]).add(allocationPoint_);
        farmingAllocationPoint[farmingAddress_] = allocationPoint_;

        emit UpdateFarmingAllocationPoint(farmingAddress_, allocationPoint_);
    }

    /**
     * @notice [OWNER ONLY] Update DistributionV2 address
     */
    function updateDistributionV2Address(address newAddress) external onlyOwner {
        require(newAddress != address(0x0), "UDV2A0");
        distributionV2 = IDistributionV2(newAddress);

        emit UpdateDistributionV2Address(newAddress);
    }

    /**
     * @notice Get amount of deployed farmings
     */
    function numberOfFarmingDeployed() external view returns (uint256) {
        return allFarmings.length;
    }

    /**
     * @notice Get last deployed sale address
     */
    function lastDeployedFarming() external view returns (address) {
        return allFarmings.length > 0 ? allFarmings[allFarmings.length - 1] : address(0x0);
    }
}
