// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

interface ISale {
    struct RoundDuration {
        uint256 startTime;
        uint256 endTime;
    }

    function allocation() external view returns (RoundDuration memory);
}
