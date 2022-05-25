// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

interface IFarmingFactory {
    function countRewardAmount(
        uint256 start_,
        uint256 end_,
        address farmingAddress
    ) external view returns (uint256);

    function mintTokens(address to, uint256 amount) external;
}
