// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILPPair.sol";
import "./interfaces/ILPFactory.sol";

import "./libraries/LPLibrary.sol";

/**
 * @notice LPSwapper is MoneyMaker contract that receives 0.05% of the swaps done in the form of an LP. It swaps those LPs
 */
contract LPSwapper is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    /// @notice LP Factory address
    ILPFactory public immutable factory;

    /// @notice WAVAX address
    address private immutable wavax;

    /// @notice ERC20 Token to be received 
    address public tokenOut;

    /// @notice Set of addresses that can perform certain functions
    EnumerableSet.AddressSet private _admins;

    /// @dev Maps a token `token` to another token `bridge` so that it uses `token/bridge` pair to convert token
    mapping(address => address) internal bridges;

    event AddAdmin(address indexed admin);
    event SetTokenOut(address indexed token);
    event RemoveAdmin(address indexed admin);
    event SetBridge(address indexed token, address indexed oldBridge, address indexed bridge);
    event Convert(
        address indexed server,
        address indexed token0,
        address indexed token1,
        uint256 amount0,
        uint256 amount1,
        uint256 amountOut
    );

    modifier onlyAdmin() {
        require(_admins.contains(_msgSender()), "not an admin");
        _;
    }

    modifier onlyEOA() {
        // Try to make flash-loan exploit harder to do by only allowing externally owned addresses.
        require(_msgSender() == tx.origin, "must use EOA");
        _;
    }

    constructor(
        address factory_,
        address wavax_
    ) {
        require(factory_ != address(0), "C0");
        require(wavax_ != address(0), "C1");
        factory = ILPFactory(factory_);
        wavax = wavax_;
        tokenOut = wavax_;
        _admins.add(_msgSender());
    }

    /**
     * @notice Force using `pair/bridge` pair to convert `token`
     *
     * @param token_ The address of the tokenFrom
     * @param bridgeToken_ The address of the tokenOut
     */
    function setBridge(address token_, address bridgeToken_) external onlyAdmin {
        require(token_ != tokenOut && token_ != wavax && token_ != bridgeToken_, "invalid bridge");

        address oldBridge = bridges[token_];
        bridges[token_] = bridgeToken_;
        emit SetBridge(token_, oldBridge, bridgeToken_);
    }

    /**
     * @notice Set token out
     *
     * @param token_ The address of the ERC20 token
     */
    function setTokenOut(address token_) external onlyAdmin {
        tokenOut = token_;
        emit SetTokenOut(token_);
    }

    /**
     * @notice Returns the `bridge` of a `token`
     *
     * @param token The address of the tokenFrom
     */
    function bridgeFor(address token) public view returns (address bridge) {
        bridge = bridges[token];
        return bridge == address(0) ? wavax : bridge;
    }

    /**
     * @notice Converts a pair of tokens to tokenOut
     * @dev _convert is separate to save gas by only checking the 'onlyEOA' modifier once in case of convertMultiple
     *
     * @param token0 The address of the first token of the pair that will be converted
     * @param token1 The address of the second token of the pair that will be converted
     * @param slippage The accepted slippage, in basis points aka parts per 10,000 so 5000 is 50%
     */
    function convert(
        address token0,
        address token1,
        address receiver,
        uint256 slippage
    ) external onlyEOA onlyAdmin {
        require(slippage < 5_000, "slippage needs to be lower than 50%");
        _convert(token0, token1, receiver, slippage);
    }

    /**
     * @notice Converts a list of pairs of tokens to tokenOut
     * @dev _convert is separate to save gas by only checking the 'onlyEOA' modifier once in case of convertMultiple
     *
     * @param token0 The list of addresses of the first token of the pairs that will be converted
     * @param token1 The list of addresses of the second token of the pairs that will be converted
     * @param slippage The accepted slippage, in basis points aka parts per 10,000 so 5000 is 50%
     */
    function convertMultiple(
        address[] calldata token0,
        address[] calldata token1,
        address receiver,
        uint256 slippage
    ) external onlyEOA onlyAdmin {
        // TODO: This can be optimized a fair bit, but this is safer and simpler for now
        require(slippage < 5_000, "slippage needs to be lower than 50%");
        require(token0.length == token1.length, "tokens arrays length don't match");

        uint256 len = token0.length;
        for (uint256 i = 0; i < len; i++) {
            _convert(token0[i], token1[i], receiver, slippage);
        }
    }

    /**
     * @notice Converts a pair of tokens to tokenOut
     * @dev _convert is separate to save gas by only checking the 'onlyEOA' modifier once in case of convertMultiple
     *
     * @param token0 The address of the first token of the pair that is currently being converted
     * @param token1 The address of the second token of the pair that is currently being converted
     * @param slippage The accepted slippage, in basis points aka parts per 10,000 so 5000 is 50%
     */
    function _convert(
        address token0,
        address token1,
        address receiver,
        uint256 slippage
    ) internal {
        uint256 amount0;
        uint256 amount1;

        // handle case where non-LP tokens need to be converted
        if (token0 == token1) {
            amount0 = IERC20(token0).balanceOf(address(this));
            amount1 = 0;
        } else {
            ILPPair pair = ILPPair(factory.getPair(token0, token1));
            require(address(pair) != address(0), "invalid pair");

            IERC20(address(pair)).safeTransfer(address(pair), pair.balanceOf(address(this)));

            // take balance of tokens in this contract before burning the pair, incase there are already some here
            uint256 tok0bal = IERC20(token0).balanceOf(address(this));
            uint256 tok1bal = IERC20(token1).balanceOf(address(this));

            pair.burn(address(this));

            // subtract old balance of tokens from new balance
            // the return values of pair.burn cant be trusted due to transfer tax tokens
            amount0 = IERC20(token0).balanceOf(address(this)) - tok0bal;
            amount1 = IERC20(token1).balanceOf(address(this)) - tok1bal;
        }

        uint256 amountOut = _convertStep(token0, token1, amount0, amount1, receiver, slippage);
        emit Convert(_msgSender(), token0, token1, amount0, amount1, amountOut);
    }

    /**
     * @notice Used to convert two tokens to `tokenOut`, step by step, called recursively
     *
     * @param token0 The address of the first token
     * @param token1 The address of the second token
     * @param amount0 The amount of the `token0`
     * @param amount1 The amount of the `token1`
     * @param slippage The accepted slippage, in basis points aka parts per 10,000 so 5000 is 50%
     *
     * @return amountOut The amount of token
     */
    function _convertStep(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        address receiver,
        uint256 slippage
    ) internal returns (uint256 amountOut) {
        // Interactions
        if (token0 == token1) {
            uint256 amount = amount0 + amount1;
            if (token0 == tokenOut) {
                IERC20(tokenOut).safeTransfer(receiver, amount);
                amountOut = amount;
            } else if (token0 == wavax) {
                amountOut = _swap(wavax, tokenOut, amount, receiver, slippage);
            } else {
                address bridge = bridgeFor(token0);
                amount = _swap(token0, bridge, amount, address(this), slippage);
                amountOut = _convertStep(bridge, bridge, amount, 0, receiver, slippage);
            }
        } else if (token0 == tokenOut) {
            // eg. TOKEN - AVAX
            IERC20(tokenOut).safeTransfer(receiver, amount0);
            amountOut = _swap(token1, tokenOut, amount1, receiver, slippage) + amount0;
        } else if (token1 == tokenOut) {
            // eg. USDT - TOKEN
            IERC20(tokenOut).safeTransfer(receiver, amount1);
            amountOut = _swap(token0, tokenOut, amount0, receiver, slippage) + amount1;
        } else if (token0 == wavax) {
            // eg. AVAX - USDC
            uint256 amountIn = _swap(token1, wavax, amount1, address(this), slippage) + amount0;
            amountOut = _swap(wavax, tokenOut, amountIn, receiver, slippage);
        } else if (token1 == wavax) {
            // eg. USDT - AVAX
            uint256 amountIn = _swap(token0, wavax, amount0, address(this), slippage) + amount1;
            amountOut = _swap(wavax, tokenOut, amountIn, receiver, slippage);
        } else {
            // eg. MIC - USDT
            address bridge0 = bridgeFor(token0);
            address bridge1 = bridgeFor(token1);
            if (bridge0 == token1) {
                // eg. MIC - USDT - and bridgeFor(MIC) = USDT
                amountOut = _convertStep(
                    bridge0,
                    token1,
                    _swap(token0, bridge0, amount0, address(this), slippage),
                    amount1,
                    receiver,
                    slippage
                );
            } else if (bridge1 == token0) {
                // eg. WBTC - DSD - and bridgeFor(DSD) = WBTC
                amountOut = _convertStep(
                    token0,
                    bridge1,
                    amount0,
                    _swap(token1, bridge1, amount1, address(this), slippage),
                    receiver,
                    slippage
                );
            } else {
                amountOut = _convertStep(
                    bridge0,
                    bridge1, // eg. USDT - DSD - and bridgeFor(DSD) = WBTC
                    _swap(token0, bridge0, amount0, address(this), slippage),
                    _swap(token1, bridge1, amount1, address(this), slippage),
                    receiver,
                    slippage
                );
            }
        }
    }

    /**
     * @notice Swaps `amountIn` `fromToken` to `toToken` and sends it to `to`, `amountOut` is required to be greater
     * than allowed `slippage`
     *
     * @param fromToken The address of token that will be swapped
     * @param toToken The address of the token that will be received
     * @param amountIn The amount of the `fromToken`
     * @param to The address that will receive the `toToken`
     * @param slippage The accepted slippage, in basis points aka parts per 10,000 so 5000 is 50%
     *
     * @return amountOut The amount of `toToken` sent to `to`
     */
    function _swap(
        address fromToken,
        address toToken,
        uint256 amountIn,
        address to,
        uint256 slippage
    ) internal returns (uint256 amountOut) {
        ILPPair pair = ILPPair(factory.getPair(fromToken, toToken));
        require(address(pair) != address(0), "no pair found");

        (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
        (uint256 reserveInput, uint256 reserveOutput) = fromToken == pair.token0()
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        IERC20(fromToken).safeTransfer(address(pair), amountIn);
        uint256 amountInput = IERC20(fromToken).balanceOf(address(pair)) - reserveInput; // calculate amount that was transferred, this accounts for transfer taxes

        amountOut = LPLibrary.getAmountOut(amountInput, reserveInput, reserveOutput);

        {
            uint256 rest = uint256(10_000) - slippage;
            /// @dev We simulate the amount received if we did a swapIn and swapOut without updating the reserves,
            /// hence why we do rest^2, i.e. calculating the slippage twice cause we actually do two swaps.
            /// This allows us to catch if a pair has low liquidity
            require(
                LPLibrary.getAmountOut(amountOut, reserveOutput, reserveInput) >=
                    amountInput * rest * rest / 100_000_000,
                "slippage caught"
            );
        }

        (uint256 amount0Out, uint256 amount1Out) = fromToken == pair.token0()
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));
        pair.swap(amount0Out, amount1Out, to, new bytes(0));
    }

    /**
     * @notice Adds a user to the authorized addresses
     *
     * @param admin_ The address to add
     */
    function addAdmin(address admin_) external onlyOwner {
        require(_admins.add(admin_), "unauthorized");
        emit AddAdmin(admin_);
    }

    /**
     * @notice Removes a user to the authorized addresses
     *
     * @param admin_ The address to add
     */
    function removeAdmin(address admin_) external onlyOwner {
        require(_admins.remove(admin_), "unauthorized");
        emit RemoveAdmin(admin_);
    }
}
