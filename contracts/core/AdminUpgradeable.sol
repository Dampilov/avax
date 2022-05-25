//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract AdminUpgradeable is Initializable, ContextUpgradeable {
    /// @notice Listing all admins
    address[] public admins;

    /// @notice Modifier for easier checking if user is admin
    mapping(address => bool) public isAdmin;

    /// @notice Modifier restricting access to only admin
    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "Only admin can call.");
        _;
    }

    /**
     * @notice Initializes the contract
     * @param owner_ Owner contract
     */
    function __Admin_init(address owner_) internal onlyInitializing {
        __Context_init_unchained();
        __Admin_init_unchained(owner_);
    }

    function __Admin_init_unchained(address admin_) internal onlyInitializing {
        admins.push(admin_);
        isAdmin[admin_] = true;
    }

    /**
     * @notice Function add admin address
     * @param adminAddress_ Admin address for add
     */
    function addAdmin(address adminAddress_) external onlyAdmin {
        // Can't add 0x address as an admin
        require(adminAddress_ != address(0x0), "AdminUpgradeable::addAdmin: Admin must be != than 0x0 address");
        // Can't add existing admin
        require(!isAdmin[adminAddress_], "AdminUpgradeable::addAdmin: Admin already exists.");
        // Add admin to array of admins
        admins.push(adminAddress_);
        // Set mapping
        isAdmin[adminAddress_] = true;
    }

    /**
     * @notice Function remove admin address
     * @param adminAddress_ Admin address for remove
     */
    function removeAdmin(address adminAddress_) external onlyAdmin {
        // Admin has to exist
        require(isAdmin[adminAddress_]);
        require(admins.length > 1, "AdminUpgradeable::removeAdmin: Can not remove all admins since contract becomes unusable");
        uint256 i = 0;

        while (admins[i] != adminAddress_) {
            if (i == admins.length) {
                revert("AdminUpgradeable::removeAdmin: Passed admin address does not exist");
            }
            i++;
        }

        // Copy the last admin position to the current index
        admins[i] = admins[admins.length - 1];

        isAdmin[adminAddress_] = false;

        // Remove the last admin, since it's double present
        admins.pop();
    }

    /**
     * @notice Fetch all admins
     */
    function getAllAdmins() external view returns (address[] memory) {
        return admins;
    }

    uint256[49] private __gap;
}
