// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract AllocationStakingMock {
    using SafeMath for uint256;

    uint256 test = 1000;

    function getiAVATAmount(address _user) public view returns (uint256 ret) {
        _user;
        ret = test.mul(1e6);
    }
}
