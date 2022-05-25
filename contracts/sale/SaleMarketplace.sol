// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./library/SafeERC20.sol";

import "./interfaces/ISalesFactory.sol";
import "./interfaces/ISale.sol";

/*
 * @title Sale marketplace
 */
contract SaleMarketplace is Ownable {
    using SafeERC20 for IERC20Decimals;

    /// @notice Sale factory address (editable)
    ISalesFactory public salesFactory;

    /// @notice User trade structs
    mapping(bytes32 => Trade) public trades;

    /// @notice User tokens mapping
    mapping(address => mapping(address => uint256)) public tokens;

    /// @notice Trade nonce for unique keccak256 hash
    uint256 private _tradeNonce;

    /// @notice Selling token whitelist addresses
    mapping(address => bool) public sellingWhitelist;

    struct Trade {
        address owner;
        address saleAddress;
        uint256 iAVATAmount;
        address sellingAddress;
        uint256 sellingAmount;
        address soldTo;
        bool sold;
    }

    constructor(address salesFactory_) {
        require(salesFactory_ != address(0x0), "C1");
        salesFactory = ISalesFactory(salesFactory_);
    }

    event Deposit(address indexed token, uint256 amount);
    event Withdraw(address indexed token, uint256 amount);
    event Create(bytes32 indexed id, address indexed owner, address saleAddress, uint256 iAVATAmount, address sellingAddress, uint256 sellingAmount);
    event Cancel(bytes32 indexed id);
    event Buy(bytes32 indexed id, address indexed buyer, address indexed seller);

    event SetSaleFactory(address indexed saleFactory);
    event SetWhitelistAddress(address indexed whitelistAddress, bool flag);

    /**
     * @notice Deposit tokens to marketplace
     * @param token ERC20 token address
     * @param amount token amount
     */
    function deposit(address token, uint256 amount) external {
        tokens[token][msg.sender] = tokens[token][msg.sender] + amount;

        IERC20Decimals(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(token, amount);
    }

    /**
     * @notice Withdraw tokens from marketplace
     * @param token ERC20 token address
     * @param amount token amount
     */
    function withdraw(address token, uint256 amount) external {
        uint256 addressAmount = tokens[token][msg.sender];
        require(addressAmount - amount >= 0, "W1");
        tokens[token][msg.sender] = addressAmount - amount;

        IERC20Decimals(token).transfer(msg.sender, amount);
        emit Withdraw(token, amount);
    }

    /**
     * @notice Create trade on the marketplace
     *
     * @param saleAddress Sale contract address
     * @param iAVATAmount iAVAT tokens amount
     * @param sellingAddress Selling token address
     * @param sellingAmount Selling token amount
     */
    function create(
        address saleAddress,
        uint256 iAVATAmount,
        address sellingAddress,
        uint256 sellingAmount
    ) external {
        require(salesFactory.isSaleCreatedThroughFactory(saleAddress), "C1");
        uint256 senderBalance = tokens[saleAddress][msg.sender];

        ISale.RoundDuration memory allocation = ISale(saleAddress).allocation();
        require(block.timestamp > allocation.startTime && block.timestamp < allocation.endTime, "C2");

        require(senderBalance >= iAVATAmount, "C3");

        bytes32 hashId = keccak256(abi.encodePacked(msg.sender, _tradeNonce));
        _tradeNonce++;

        tokens[saleAddress][msg.sender] = senderBalance - iAVATAmount;
        trades[hashId] = Trade({owner: msg.sender, saleAddress: saleAddress, iAVATAmount: iAVATAmount, sellingAddress: sellingAddress, sellingAmount: sellingAmount, sold: false, soldTo: address(0x0)});

        emit Create(hashId, msg.sender, saleAddress, iAVATAmount, sellingAddress, sellingAmount);
    }

    /**
     * @notice Cancel trade on the marketplace
     *
     * @param hashId keccak256 trade hash id
     */
    function cancel(bytes32 hashId) external {
        Trade memory trade = trades[hashId];
        require(trade.owner == msg.sender, "C1");

        tokens[trade.saleAddress][msg.sender] = tokens[trade.saleAddress][msg.sender] + trade.iAVATAmount;
        delete trades[hashId];

        emit Cancel(hashId);
    }

    /**
     * @notice Buy trade on the marketplace
     *
     * @param hashId keccak256 trade hash id
     */
    function buy(bytes32 hashId) external {
        Trade memory trade = trades[hashId];

        ISale.RoundDuration memory allocation = ISale(trade.saleAddress).allocation();
        require(block.timestamp > allocation.startTime && block.timestamp < allocation.endTime, "B1");
        require(tokens[trade.sellingAddress][msg.sender] >= trade.sellingAmount, "B2");
        require(trade.owner != msg.sender, "B3");
        require(trade.sold == false, "B4");

        trades[hashId].sold = true;
        trades[hashId].soldTo = msg.sender;

        tokens[trade.saleAddress][msg.sender] = tokens[trade.saleAddress][msg.sender] + trade.iAVATAmount;
        tokens[trade.sellingAddress][msg.sender] = tokens[trade.sellingAddress][msg.sender] - trade.sellingAmount;

        tokens[trade.sellingAddress][trade.owner] = tokens[trade.sellingAddress][trade.owner] + trade.sellingAmount;

        emit Buy(hashId, msg.sender, trade.owner);
    }

    // OWNER FUNCTIONS

    /**
     * @notice Set sale factory contract address
     *
     * @param saleFactory_ contract address
     */
    function setSaleFactory(address saleFactory_) external onlyOwner {
        require(saleFactory_ != address(0x0), "C1");

        salesFactory = ISalesFactory(saleFactory_);
        emit SetSaleFactory(saleFactory_);
    }

    /**
     * @notice Set whitelist address for selling token
     *
     * @param sellingAddress ERC20 token address
     * @param flag_ add/remove from whitelist
     */
    function setWhitelistAddress(address sellingAddress, bool flag_) external onlyOwner {
        require(sellingAddress != address(0x0), "C1");

        sellingWhitelist[sellingAddress] = flag_;
        emit SetWhitelistAddress(sellingAddress, flag_);
    }
}
