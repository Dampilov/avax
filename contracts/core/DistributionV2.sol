// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "./interfaces/IMintableOwnableERC20.sol";
import "./AdminUpgradeable.sol";

contract DistributionV2 is OwnableUpgradeable, PausableUpgradeable, AdminUpgradeable {
    using SafeMath for uint256;
    using SafeERC20Upgradeable for IMintableOwnableERC20;

    /// @notice Reward emission struct
    struct RewardEmission {
        uint256 start;
        uint256 end;
        uint256 rewardPerSecond;
    }

    /// @notice ERC20 Cappable token contract address
    IMintableOwnableERC20 public token;

    /// @notice Precios for reward emission maths
    uint256 public constant REWARD_PRECISION = 1e12;

    /// @notice Precios for reward emission maths
    uint256 public constant ALLOCATION_PRECISION = 100;

    /// @notice How much pools have already used allocation. Max: 100
    uint256 public allocationPointUsed;

    /// @notice Mapping of pools (poolAddress => allocationPoint)
    mapping(address => uint256) public pools;

    /// @notice Reward emission array
    RewardEmission[] public rewardEmission;

    event MintTokens(address indexed receiver, uint256 indexed amount);

    /**
     * @notice Initializer for an upgradable contract
     * @param token_ ERC20 Token address
     * @param rewardEmission_ array of rewards emission
     */
    function initialize(IMintableOwnableERC20 token_, RewardEmission[] calldata rewardEmission_) public initializer {
        __Ownable_init();
        __Pausable_init();
        __Admin_init(msg.sender);

        token = token_;

        uint256 rewardEmissionLength = rewardEmission_.length;

        require(rewardEmissionLength > 1, "DistributionV2::initialize: There must be at least 2 reward emissions");

        for (uint256 i = 0; i < rewardEmissionLength; i++) {
            require(rewardEmission_[i].start < rewardEmission_[i].end, "DistributionV2::initialize: start must be less than end timestamp");

            // If it is not the last emission
            if (i != rewardEmissionLength - 1) {
                require(rewardEmission_[i].end + 1 == rewardEmission_[i + 1].start, "DistributionV2::initialize: first end reward emission must be on 1 point less than the next start emission");
            }

            rewardEmission.push(rewardEmission_[i]);
        }
    }

    /**
     * @notice Function to mint erc20 tokens
     * @param to_ Address to which the funds are minted
     * @param amount_ Amount mint token
     */
    function mintTokens(address to_, uint256 amount_) external onlyAdmin whenNotPaused {
        token.mint(to_, amount_);
        emit MintTokens(to_, amount_);
    }

    /**
     * @notice Count the reward amount of distributed tokens
     * @param start_ start timestamp
     * @param end_ end timestamp
     */
    function countRewardAmount(uint256 start_, uint256 end_) external view returns (uint256) {
        require(start_ <= end_, "DistributionV2::countRewardAmount: start must be less than end");

        uint256 amount = 0;
        bool startEntry = false;

        /** @dev All cases
         *   When start and end less than the first reward start date (Check 1)
         * -s--e-|------|------|------|------>
         *   When start and end too far (Check 2)
         * ------|------|------|------|-s--e->
         *   When start less than the first reward end date and end too far (Check 0, 5, 4)
         * ---s--|------|---e--|------|------>
         *   When start and end on adjacent periods (Check 2, 4)
         * ------|---s--|---e--|------|------>
         *   When start and end on the same period (Check 2, 3)
         * ------|-s--e-|------|------|------>
         *   When start and end far from each other (Check 2, 4, 5)
         * ------|---s--|------|---e--|------>
         *   When end too far (Check 2, 5)
         * ------|---s--|------|------|---e-->
         */

        // Check 0
        if (start_ < rewardEmission[0].start && end_ > rewardEmission[0].start) {
            startEntry = true;
        }

        // Check 1
        if (start_ < rewardEmission[0].start && end_ < rewardEmission[0].start) {
            return 0;
        }

        // Check 2
        if (rewardEmission[rewardEmission.length - 1].end < start_) {
            return 0;
        }

        for (uint256 i = 0; i < rewardEmission.length; i++) {
            // Check 2
            if (start_ >= rewardEmission[i].start && start_ <= rewardEmission[i].end) {
                // Check 3
                if (end_ <= rewardEmission[i].end) {
                    // ------|------|------|------|------>
                    //     or
                    // ------|-s**e-|------|------|------>
                    //     or
                    // ------|------|-s**e-|------|------>
                    amount = end_.sub(start_).mul(rewardEmission[i].rewardPerSecond).div(REWARD_PRECISION);
                    break;
                }

                startEntry = true;

                // ------|--s***|------|---e--|------>
                //     or
                // ------|------|--s***|------|---e-->
                amount = amount.add(rewardEmission[i].end.sub(start_).mul(rewardEmission[i].rewardPerSecond).div(REWARD_PRECISION));
                continue;
            }

            // Check 4
            if (end_ <= rewardEmission[i].end) {
                // -s****|***e--|------|------|------>
                //     or
                // -s****|******|***e--|------|------>
                //     or
                // ------|-s****|******|***e--|------>
                amount = amount.add(end_.sub(rewardEmission[i].start).mul(rewardEmission[i].rewardPerSecond).div(REWARD_PRECISION));
                break;
            }

            // Check 5
            if (startEntry == true) {
                // -s****|******|---e--|------|------>
                //     or
                // -s****|******|******|---e--|------>
                amount = amount.add(rewardEmission[i].end.sub(rewardEmission[i].start).mul(rewardEmission[i].rewardPerSecond).div(REWARD_PRECISION));
            }
        }

        return _calculatePoolAllocationReward(amount, msg.sender);
    }

    /**
     * @notice Set pool address allocation point
     * @param poolAddress_ Pool contract address
     * @param allocationPoint_ Pool allocation point
     */
    function setPool(address poolAddress_, uint256 allocationPoint_) external onlyOwner {
        allocationPointUsed = allocationPointUsed.sub(pools[poolAddress_]).add(allocationPoint_);
        require(allocationPointUsed <= 100, "DistributionV2::setPool: allowed allocation exceeded");

        pools[poolAddress_] = allocationPoint_;
    }

    /**
     * @notice Calculate pool allocation rewards
     * @param amount_ Counted amount of minted tokens
     * @param poolAddress_ Pool contract address
     */
    function _calculatePoolAllocationReward(uint256 amount_, address poolAddress_) private view returns (uint256) {
        return amount_.mul(pools[poolAddress_]).div(ALLOCATION_PRECISION);
    }

    /**
     * @notice Transfer the erc20 token owner to another address. Careful, the contract will lose the ability to mint tokens.
     * @param newOwner_ new owner address
     */
    function transferTokenOwnership(address newOwner_) external onlyOwner {
        token.transferOwnership(newOwner_);
    }
}
