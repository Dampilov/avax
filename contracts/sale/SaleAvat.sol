// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SaleAvat smart contract
contract SaleAvat is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    address public immutable signatory;
    uint256 public startSale;
    uint256 public endSale;
    uint256 public totalTokensClaim;
    uint256 public totalTokensBuy;
    uint256 public participants;
    mapping(address => uint256) public totalFundsCollected;
    mapping(address => uint256) public addressAllocationSpent;
    mapping(address => mapping(address => uint256)) public addressFundsCollected;

    /// @notice The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /// @notice The EIP-712 typehash for the permit struct used by the contract
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address participant,uint256 value,uint256 nonce,uint256 deadline)");

    /// @notice A record of states for signing / validating signatures
    mapping(address => uint256) public nonces;

    string public constant name = "AVAT";

    uint256 public constant _precisionRate = 100;
    uint256[] private _distributionDates;
    IERC20 private immutable _withdrawToken;
    DistributionPeriod[] private _distributionPeriods;

    mapping(address => IERC20) private _depositTokens;
    mapping(address => uint256) private _rateDepositTokens;
    mapping(address => DistributionAddress[]) private _distributionAddresses;

    struct DistributionPeriod {
        uint256 timestamp;
        uint256 percent;
    }

    struct DistributionAddress {
        uint256 amount;
        bool isClaimed;
    }

    uint256 public timeLockStartsAt;
    // Timelock in seconds. For example: 86400 = 24 hours
    uint256 public immutable _timelock;

    event CreateDistributionPeriod(DistributionPeriod[] distributionPeriods);
    event TimelockLeftover(uint256 indexed timelock, uint256 indexed amount, address indexed receiver);
    event Leftover(uint256 indexed amount, address indexed receiver);
    event UpdateTokenRates(address[] indexed depositTokens, uint256[] indexed rates);
    event CollectToken(address indexed token, uint256 indexed amount, address indexed receiver);
    event ClaimToken(uint256 indexed periodId, uint256 indexed amount);
    event BuyToken(address indexed buyer, uint256 indexed sentAmount);

    constructor(
        address[] memory depositTokens_,
        uint256[] memory rates_,
        address withdrawToken_,
        address signatory_,
        uint256 timelock_
    ) {
        uint256 tokensLength = depositTokens_.length;
        require(timelock_ > 0, "Timelock must be greater than 0");

        _timelock = timelock_;

        for (uint256 i = 0; i < tokensLength; i++) {
            _depositTokens[depositTokens_[i]] = IERC20(depositTokens_[i]);
            _rateDepositTokens[depositTokens_[i]] = rates_[i];
        }

        _withdrawToken = IERC20(withdrawToken_);
        signatory = signatory_;
    }

    /**
     * @notice Creates distribution period
     * param distributionPeriods_ Period for create
     * param startSale_ Start date for sale
     * param endSale_ End date for sale
     */
    function createDistributionPeriod(
        DistributionPeriod[] memory distributionPeriods_,
        uint256 startSale_,
        uint256 endSale_
    ) external onlyOwner {
        if (startSale > 0) {
            require(block.timestamp < startSale, "SaleAvat::createDistributionPeriod: Start of sale should be greater");
            delete _distributionPeriods;
            delete _distributionDates;
        }

        require(startSale_ != 0, "SaleAvat::createDistributionPeriod: Start of sale cannot set to zero");
        require(startSale_ < endSale_, "SaleAvat::createDistributionPeriod: Start of sale should be lesser then End of sale");
        require(endSale_ < distributionPeriods_[0].timestamp, "SaleAvat::createDistributionPeriod: End of sale should be lesser then fist claim period");

        startSale = startSale_;
        endSale = endSale_;

        uint256 periodsLength = distributionPeriods_.length;
        uint256 amountPercent = 0;

        uint256 lastTimestamp = 0;

        for (uint256 i = 0; i < periodsLength; i++) {
            require(lastTimestamp < distributionPeriods_[i].timestamp, "SaleAvat::createDistributionPeriod:periods must be in ASC order");
            lastTimestamp = distributionPeriods_[i].timestamp;
            amountPercent = amountPercent.add(distributionPeriods_[i].percent);
            _distributionDates.push(distributionPeriods_[i].timestamp);
            _distributionPeriods.push(distributionPeriods_[i]);
        }
        require(amountPercent.div(_precisionRate) == 100, "SaleAvat::createDistributionPeriod: Total percentage should be 100%");

        timeLockStartsAt = distributionPeriods_[periodsLength - 1].timestamp;

        emit CreateDistributionPeriod(_distributionPeriods);
    }

    /**
     * @notice Get distribution period
     * param periodId_ Id of return period
     * return DistributionPeriod
     */
    function getDistributionPeriod(uint256 periodId_) external view returns (DistributionPeriod memory) {
        return _distributionPeriods[periodId_];
    }

    /**
     * @notice Buy token.
     * @param addressTransferFrom The address to be approved
     * @param amountTransferFrom The number of tokens that are approved (2^256-1 means infinite)
     * @param valueAllocation The number of tokens that are get for allocation (2^256-1 means infinite)
     * @param nonce The contract state required to match the signature
     * @param deadline The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function buyToken(
        address addressTransferFrom,
        uint256 amountTransferFrom,
        uint256 valueAllocation,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        bool accept = checkSig(msg.sender, valueAllocation, nonce, deadline, v, r, s);

        require(accept == true, "SaleAvat::buyToken: invalid signature");

        if (addressAllocationSpent[msg.sender] == 0) {
            participants = participants.add(1);
        }

        addressAllocationSpent[msg.sender] = addressAllocationSpent[msg.sender].add(amountTransferFrom);
        require(addressAllocationSpent[msg.sender] <= valueAllocation, "SaleAvat::buyToken: Allocation spent");

        _depositTokens[addressTransferFrom].safeTransferFrom(msg.sender, address(this), amountTransferFrom);

        uint256 amount = (amountTransferFrom).mul(_precisionRate).div(_rateDepositTokens[addressTransferFrom]);
        require(totalTokensBuy.add(amount) <= _withdrawToken.balanceOf(address(this)), "SaleAvat::buyToken: No available  tokens for buy");

        createDistributionAddress(amount, msg.sender);

        totalTokensBuy = totalTokensBuy.add(amount);
        totalFundsCollected[addressTransferFrom] = totalFundsCollected[addressTransferFrom].add(amountTransferFrom);
        addressFundsCollected[addressTransferFrom][msg.sender] = addressFundsCollected[addressTransferFrom][msg.sender].add(amountTransferFrom);

        emit BuyToken(msg.sender, amountTransferFrom);
    }

    /**
     * @notice Creates distribution for address
     * param amount_ Amount for buy token
     * param participant_ User who is allowed to purchase
     */
    function createDistributionAddress(uint256 amount_, address participant_) internal {
        require(block.timestamp >= startSale, "SaleAvat::createDistributionAddress: Sale has not started");
        require(block.timestamp <= endSale, "SaleAvat::createDistributionAddress: Sale ended, so sorry");

        uint256 _amountPercent = 0;

        for (uint256 i = 0; i < _distributionPeriods.length; i++) {
            _amountPercent = amount_.mul(_distributionPeriods[i].percent).div(100).div(_precisionRate);
            DistributionAddress memory distributionAddress = DistributionAddress({amount: _amountPercent, isClaimed: false});
            if (i < _distributionAddresses[participant_].length) {
                _distributionAddresses[participant_][i].amount = _distributionAddresses[participant_][i].amount.add(distributionAddress.amount);
            } else {
                _distributionAddresses[participant_].push(distributionAddress);
            }
        }
    }

    /**
     * @notice Get distribution for address
     * param participant_ User who is allowed to purchase
     */
    function getDistributionAddress(address participant_) external view returns (DistributionAddress[] memory) {
        return _distributionAddresses[participant_];
    }

    /**
     * @notice Claim available tokens.
     * @param periodId_ Number of period
     */
    function claimToken(uint256 periodId_) external {
        address participant = msg.sender;
        require(_distributionAddresses[participant][periodId_].isClaimed == false && _distributionAddresses[participant][periodId_].amount != 0, "claimToken: Participant does not have funds for withdrawal");
        require(isPeriodUnlocked(periodId_) == true, "SaleAvat::claimToken: Claim date is not arrived");
        require(periodId_ < _distributionPeriods.length, "SaleAvat::claimToken: PeriodId should be lesser then total periods");

        _distributionAddresses[participant][periodId_].isClaimed = true;
        _withdrawToken.safeTransfer(participant, _distributionAddresses[participant][periodId_].amount);
        totalTokensClaim = totalTokensClaim.add(_distributionAddresses[participant][periodId_].amount);

        emit ClaimToken(periodId_, _distributionAddresses[participant][periodId_].amount);
    }

    /**
     * @notice Collect raised funds
     * @param token_ Contract address withdraw token
     * @param amount_ Available amount to withdraw
     * @param receiver_ Address owner
     */
    function collectToken(
        address token_,
        uint256 amount_,
        address receiver_
    ) external onlyOwner {
        _depositTokens[token_].safeTransfer(receiver_, amount_);
        emit CollectToken(token_, amount_, receiver_);
    }

    /**
     * @notice Collect leftover. Owner can take leftover after last distribution period start + timelock
     * @param amount_ Available amount to withdraw
     * @param receiver_ Address owner
     */
    function leftover(uint256 amount_, address receiver_) external onlyOwner {
        require(block.timestamp > timeLockStartsAt + _timelock, "leftover: too early to leftover");
        require(_withdrawToken.balanceOf(address(this)).sub(totalTokensBuy.sub(totalTokensClaim)) >= amount_, "SaleAvat::timelockLeftover: No available tokens for leftover");
        _withdrawToken.safeTransfer(receiver_, amount_);
        emit Leftover(amount_, receiver_);
    }

    /**
     * @notice Update token and rates
     * @param depositTokens_ ERC20 address
     * @param rates_ Rate for buy token
     */
    function updateTokenRates(address[] calldata depositTokens_, uint256[] calldata rates_) external onlyOwner {
        uint256 tokensLength = depositTokens_.length;

        for (uint256 i = 0; i < tokensLength; i++) {
            _depositTokens[depositTokens_[i]] = IERC20(depositTokens_[i]);
            _rateDepositTokens[depositTokens_[i]] = rates_[i];
        }

        emit UpdateTokenRates(depositTokens_, rates_);
    }

    /**
     * @notice Get rate
     * @param token_ ERC20 address
     * @return rate Rate for buy token
     */
    function getRate(address token_) external view returns (uint256) {
        return _rateDepositTokens[token_];
    }

    /**
     * @notice Collect leftover
     * @return length periods
     */
    function getCountPeriod() external view returns (uint256) {
        return _distributionPeriods.length;
    }

    /**
     * @notice Get array of distribution dates
     * @return array of distribution dates
     */
    function getDistributionDates() external view returns (uint256[] memory) {
        return _distributionDates;
    }

    /**
     * @notice Check unlock period or not array of distribution dates
     * param periodId_ Id of period
     * @return true if unlock period? else return false
     */
    function isPeriodUnlocked(uint256 periodId_) public view returns (bool) {
        return block.timestamp >= _distributionDates[periodId_];
    }

    /**
     * @notice Check safe96
     *
     **/
    function safe96(uint256 n, string memory errorMessage) internal pure returns (uint96) {
        require(n < 2**96, errorMessage);

        return uint96(n);
    }

    /**
     * @notice Get chain id for sign
     *
     * @return chainId
     **/
    function getChainId() internal view returns (uint256) {
        uint256 chainId;

        assembly {
            chainId := chainid()
        }

        return chainId;
    }

    /**
     * @notice Check permit to approve but token
     * @param participant The address to be approved
     * @param rawAmount The number of tokens that are approved (2^256-1 means infinite)
     * @param nonce The contract state required to match the signature
     * @param deadline The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function checkSig(
        address participant,
        uint256 rawAmount,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public view returns (bool) {
        uint96 amount;

        if (rawAmount == type(uint256).max) {
            amount = type(uint96).max;
        } else {
            amount = safe96(rawAmount, "SaleAvat::permit: amount exceeds 96 bits");
        }

        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), getChainId(), address(this)));
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, participant, rawAmount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address _signatory = ECDSA.recover(digest, v, r, s);

        require(_signatory != address(0), "SaleAvat::permitBySig: invalid signature");
        require(signatory == _signatory, "SaleAvat::permitBySig: unauthorized");
        require(block.timestamp <= deadline, "SaleAvat::permitBySig: signature expired");

        return true;
    }
}
