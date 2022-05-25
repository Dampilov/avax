// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

library SaleLibrary {
    using SafeMath for uint256;

    /// @notice The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /// @notice The EIP-712 typehash for the permit struct used by the contract
    bytes32 public constant PERMIT_LOTTERY_TYPEHASH = keccak256("Permit(address participant,uint256 tokenAmount,uint256 deadline)");

    /// @notice The EIP-712 typehash for the permit struct used by the contract
    bytes32 public constant PERMIT_BUY_TYPEHASH = keccak256("Permit(address participant,uint256 deadline)");

    string public constant saleName = "Avata Sale";

    /**
     * @notice Check safe96
     **/
    function safe96(uint256 n) internal pure returns (uint96) {
        require(n < 2**96, "amount exceeds 96 bits");
        return uint96(n);
    }

    /**
     * @notice Check permit to mint lottery allocation
     * @param participant Participant address
     * @param tokenAmount amount of tokens
     * @param deadline The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function permitLotteryAllocation(
        address signatory,
        address participant,
        uint256 tokenAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (bool) {
        uint96 amount;

        if (tokenAmount == type(uint256).max) {
            amount = type(uint96).max;
        } else {
            amount = safe96(tokenAmount);
        }

        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(saleName)), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(PERMIT_LOTTERY_TYPEHASH, participant, tokenAmount, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address _signatory = ecrecover(digest, v, r, s);

        if (_signatory == address(0) || signatory != _signatory || block.timestamp > deadline) {
            return false;
        }

        return true;
    }

    /**
     * @notice Check permit to buy tokens. This function used to be sure that user was approved in KYC system
     * @param participant Participant address
     * @param deadline The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function permitBuy(
        address signatory,
        address participant,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (bool) {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(saleName)), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(PERMIT_BUY_TYPEHASH, participant, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address _signatory = ecrecover(digest, v, r, s);

        if (_signatory == address(0) || signatory != _signatory || block.timestamp > deadline) {
            return false;
        }

        return true;
    }
}
