// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./Sale.sol";

import "./interfaces/IFarmLensV2.sol";

contract SalesFactory is Ownable {
    /// @notice signatory address which will be sign messages for tokens buy
    address private immutable _signatory;

    /// @notice Allocation staking address
    IAllocationStaking public stakingAddress;

    /// @notice Allocation staking address
    IFarmLensV2 public farmLensV2Address;

    mapping(address => bool) public isSaleCreatedThroughFactory;

    /// @notice Expose so query can be possible only by position as well
    address[] public allSales;

    event SaleDeployed(address indexed saleContract);
    event FarmLensV2AddressUpdated(address indexed newAddress);
    event AllocationStakingUpdated(address indexed newAddress);

    constructor(
        address stakingAddress_,
        address signatory_,
        address farmLensAddress_
    ) {
        require(stakingAddress_ != address(0), "C1");
        require(farmLensAddress_ != address(0), "C2");
        require(signatory_ != address(0), "C3");
        stakingAddress = IAllocationStaking(stakingAddress_);
        farmLensV2Address = IFarmLensV2(farmLensAddress_);
        _signatory = signatory_;
    }

    /**
     * @notice [OWNER ONLY] Deploy Sale contract
     */
    function deploySale(address sellingTokenAddress) external onlyOwner {
        string memory sellingTokenSymbol = IERC20Metadata(sellingTokenAddress).symbol();

        Sale sale = new Sale(msg.sender, _signatory, address(stakingAddress), address(farmLensV2Address), sellingTokenAddress, _appendStrings(sellingTokenSymbol, " Avatalaunch"), _appendStrings("iAVAT-", sellingTokenSymbol));

        isSaleCreatedThroughFactory[address(sale)] = true;
        allSales.push(address(sale));

        emit SaleDeployed(address(sale));
    }

    /**
     * @notice [OWNER ONLY] Update AllocationStaking address
     */
    function updateAllocationStakingAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0x0));

        stakingAddress = IAllocationStaking(newAddress);

        emit AllocationStakingUpdated(newAddress);
    }

    /**
     * @notice [OWNER ONLY] Update FarmLensV2 address
     */
    function updateFarmLensV2Address(address newAddress) external onlyOwner {
        require(newAddress != address(0x0));

        farmLensV2Address = IFarmLensV2(newAddress);

        emit FarmLensV2AddressUpdated(newAddress);
    }

    /**
     * @notice Get amount of deployed sales
     */
    function numberOfSalesDeployed() external view returns (uint256) {
        return allSales.length;
    }

    /**
     * @notice Get last deployed sale address
     */
    function lastDeployedSale() external view returns (address) {
        if (allSales.length > 0) {
            return allSales[allSales.length - 1];
        }

        return address(0);
    }

    /**
     * @notice Get sales' addresses by index
     */
    function sales(uint256 startIndex, uint256 endIndex) external view returns (address[] memory) {
        require(endIndex > startIndex, "Bad input");

        address[] memory salesAddresses = new address[](endIndex - startIndex);
        uint256 index = 0;

        for (uint256 i = startIndex; i < endIndex; i++) {
            salesAddresses[index] = allSales[i];
            index++;
        }

        return salesAddresses;
    }

    function _appendStrings(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }
}
