// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

interface IDistributionV2 {
    function mintTokens(address to, uint256 amount) external;

    function countRewardAmount(uint256 start_, uint256 end_) external view returns (uint256);
}
