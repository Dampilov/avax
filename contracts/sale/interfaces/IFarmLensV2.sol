// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

interface IFarmLensV2 {
    function getTokenPrice(address tokenAddress) external view returns (uint256);
}
