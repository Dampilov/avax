// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IDistribution.sol";

/// @title Vesting contract
contract Vesting is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    // address of the Distribution Contract
    IDistribution public distributionContract;

    struct DistributionAddress {
        bool isActive;
        DistributionPeriod[] periods;
    }

    struct DistributionPeriod {
        uint256 timestamp;
        uint256 amount;
        bool isClaimed;
    }

    struct SetDistribution {
        address beneficiaryAddress;
        SetDistributionPeriod[] periods;
    }

    struct SetDistributionPeriod {
        uint256 timestamp;
        uint256 amount;
    }

    mapping(address => DistributionAddress) private _distributions;

    constructor(address distributionAddress_) {
        require(distributionAddress_ != address(0x0), "Cannot set zero address to token_");
        distributionContract = IDistribution(distributionAddress_);
    }

    event Claimed(address claimAddress, uint256 amount);
    event Distributed(address distributedAddress);
    event DistributionRemoved(address distributedAddress);
    event Minted(address receiver, uint256 amount);

    function setDistributionContract(address distributionAddress_) external onlyOwner {
        require(distributionAddress_ != address(0x0), "Cannot set zero address to token_");
        distributionContract = IDistribution(distributionAddress_);
    }

    /**
     * @dev Set new address for distribution with periods or update if address is exist.
     *
     * Requirements:
     *
     * - the caller must be owner.
     */
    function setDistribution(SetDistribution[] calldata distributionAddresses) external onlyOwner {
        uint256 adressesLength = distributionAddresses.length;

        for (uint256 addressIndex = 0; addressIndex < adressesLength; addressIndex += 1) {
            address distribution = distributionAddresses[addressIndex].beneficiaryAddress;

            if (_distributions[distribution].isActive) {
                _updateDistribution(distributionAddresses[addressIndex]);
            } else {
                _createDistribution(distributionAddresses[addressIndex]);
            }

            emit Distributed(distribution);
        }
    }

    /**
     * @dev Private function. Creates new address for distribution
     */
    function _createDistribution(SetDistribution memory newDistribution_) private {
        address distributionAddress = newDistribution_.beneficiaryAddress;

        _distributions[distributionAddress].isActive = true;
        delete _distributions[distributionAddress].periods;

        uint256 periodsLength = newDistribution_.periods.length;
        uint256 currentTime = getCurrentTime();
        uint256 lastTimestamp = 0;

        for (uint256 i = 0; i < periodsLength; i += 1) {
            SetDistributionPeriod memory period = newDistribution_.periods[i];

            require(period.timestamp > lastTimestamp, "Timestamp must be greater than previous timestamp");

            lastTimestamp = period.timestamp;

            require(period.timestamp > currentTime, "Timestamp must be greater than current time");

            require(period.amount > 0, "Amount must be greater than 0");

            _distributions[distributionAddress].periods.push(DistributionPeriod(period.timestamp, period.amount, false));
        }
    }

    /**
     * @dev Private function. Update address periods for distribution.
     * If address has 3 periods and function has 2 - last period (3) will be deleted.
     * Can't edit claimed periods.
     */
    function _updateDistribution(SetDistribution memory editedDistribution_) private {
        address distributionAddress = editedDistribution_.beneficiaryAddress;

        uint256 periodsLength = _distributions[distributionAddress].periods.length;
        uint256 newPeriodsLength = editedDistribution_.periods.length;

        require(newPeriodsLength != 0, "You must provide any periods");

        uint256 currentTime = getCurrentTime();
        uint256 lastTimestamp = 0;

        for (uint256 i = 0; i < periodsLength; i += 1) {
            SetDistributionPeriod memory newPeriod = editedDistribution_.periods[i];
            DistributionPeriod memory oldPeriod = _distributions[distributionAddress].periods[i];

            require(newPeriod.timestamp > lastTimestamp, "Timestamp must be greater than previous timestamp");

            lastTimestamp = newPeriod.timestamp;

            if (newPeriod.timestamp == oldPeriod.timestamp && newPeriod.amount == oldPeriod.amount) {
                continue;
            }

            require(oldPeriod.isClaimed == false, "Cant update period that already claimed");

            require(oldPeriod.timestamp > currentTime, "Cant update period that can be claimed");

            require(newPeriod.timestamp > currentTime, "Timestamp must be greater than current time");

            require(newPeriod.amount > 0, "Amount must be greater than 0");

            _distributions[distributionAddress].periods[i] = DistributionPeriod(newPeriod.timestamp, newPeriod.amount, false);

            if (i == newPeriodsLength - 1) {
                break;
            }
        }

        for (uint256 i = periodsLength - 1; i >= newPeriodsLength; i -= 1) {
            _distributions[distributionAddress].periods.pop();
        }
    }

    /**
     * @dev Set isActive to false, means that seed investor address is not actually working (deleted)
     */
    function removeDistributions(address[] memory distributionAddresses) external onlyOwner {
        uint256 length = distributionAddresses.length;
        for (uint256 i = 0; i < length; i += 1) {
            require(_distributions[distributionAddresses[i]].isActive, "Address is not exist");

            _distributions[distributionAddresses[i]].isActive = false;

            emit DistributionRemoved(distributionAddresses[i]);
        }
    }

    /**
     * @dev Claim available tokens. `to` - address that will get tokens
     */
    function claimTokens(address to) external nonReentrant {
        require(_distributions[msg.sender].isActive, "No claiming periods");

        DistributionAddress storage distribution = _distributions[msg.sender];

        uint256 currentTime = getCurrentTime();
        uint256 claimAmount = 0;
        uint256 periodLength = distribution.periods.length;

        for (uint256 i = 0; i < periodLength; i += 1) {
            DistributionPeriod memory period = distribution.periods[i];

            if (period.isClaimed == true) {
                continue;
            }

            if (period.timestamp > currentTime) {
                break;
            }

            claimAmount = claimAmount.add(period.amount);
            distribution.periods[i].isClaimed = true;
        }

        require(claimAmount != 0, "No available claiming periods");

        distributionContract.mintTokens(to, claimAmount);
        emit Claimed(to, claimAmount);
    }

    /**
     * @dev Get amount that can be claimed by provided address
     */
    function getAmountToBeClaimed(address distributionAddress) external view returns (uint256) {
        if (!_distributions[distributionAddress].isActive) {
            return 0;
        }

        DistributionAddress storage distribution = _distributions[distributionAddress];

        uint256 currentTime = getCurrentTime();
        uint256 claimAmount = 0;
        uint256 periodLength = distribution.periods.length;

        for (uint256 i = 0; i < periodLength; i += 1) {
            DistributionPeriod memory period = distribution.periods[i];

            if (period.isClaimed == true) {
                continue;
            }

            if (period.timestamp > currentTime) {
                break;
            }

            claimAmount = claimAmount.add(period.amount);
        }

        return claimAmount;
    }

    /**
     * @dev Get address full distribution info.
     */
    function getDistribution(address distributionAddress) external view returns (DistributionAddress memory) {
        DistributionAddress memory distribution = _distributions[distributionAddress];
        return distribution;
    }

    /**
     * @dev Returns current time.
     */
    function getCurrentTime() internal view virtual returns (uint256) {
        return block.timestamp;
    }
}
