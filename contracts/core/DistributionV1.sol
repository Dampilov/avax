// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IMintableOwnableERC20.sol";

/// @title Distribution contract
contract DistributionV1 is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IMintableOwnableERC20;

    // address of the ERC20 token
    IMintableOwnableERC20 private immutable _token;

    // vesting address
    address public vestingAddress;

    event MintTokens(address indexed receiver, uint256 indexed amount);
    event SetVestingAdress(address indexed vestingAddress);

    constructor(address token_) {
        require(token_ != address(0x0), "Cannot set zero address to token_");
        _token = IMintableOwnableERC20(token_);
    }

    // Function to mint erc20 tokens
    function mintTokens(address to, uint256 amount) external onlyVesting {
        _token.mint(to, amount);
        emit MintTokens(to, amount);
    }

    modifier onlyVesting() {
        require(vestingAddress == msg.sender, "caller is not the vesting contract");
        _;
    }

    function setVestingAdress(address vestingAddress_) external onlyOwner {
        require(vestingAddress_ != address(0x0), "Cannot set zero address to vestingAddress_");
        vestingAddress = vestingAddress_;

        emit SetVestingAdress(vestingAddress_);
    }

    // Transfer the erc20 token owner to another address. BE CAREFUL, the contract will lose the ability to mint tokens.
    function transferTokenOwnership(address newOwner) external onlyOwner {
        _token.transferOwnership(newOwner);
    }
}
