//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

interface IWAVAX {
    function deposit() external payable;

    function balanceOf(address owner) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function withdraw(uint256) external;
}
