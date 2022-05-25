// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract FarmLensV2Mock {
    using SafeMath for uint256;

    /// @notice Get the price of a token in Usd.
    function getTokenPrice(address tokenAddress) public pure returns (uint256) {
        tokenAddress;
        return uint256(1).mul(1e18);
    }
}
