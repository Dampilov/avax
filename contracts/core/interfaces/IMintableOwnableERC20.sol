//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IMintableOwnableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;

    function transferOwnership(address newOwner) external;
}
