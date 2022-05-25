// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.12;
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./SaleToken.sol";

import "./library/SafeERC20.sol";
import "./library/SaleLibrary.sol";

import "./interfaces/IERC20Decimals.sol";
import "./interfaces/IFarmLensV2.sol";
import "./interfaces/IAllocationStaking.sol";

/// @title Avata Sale smart contract
contract Sale is SaleToken, Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20Decimals;

    /// @notice Signatory address
    address public immutable signatory;

    /// @notice Start of the sale
    bool public isInitialized;

    /// @notice Start and end of the allocation
    RoundDuration public allocation;

    /// @notice Start and end of the sale
    RoundDuration public sale;

    /// @notice Start and end of the FCFS
    RoundDuration public fcfs;

    /// @notice Total tokens that users claimed
    uint256 public totalTokensClaim;

    /// @notice Total tokens that users bought
    uint256 public totalTokensBuy;

    /// @notice Number of users that bought tokens
    uint256 public participants;

    /// @notice Total deposited tokens collected
    mapping(address => uint256) public totalFundsCollected;

    /// @notice Address selling tokens collected
    mapping(address => uint256) public addressFundsCollected;

    /// @notice Selling tokens address
    IERC20Decimals public immutable sellingTokenAddress;

    /// @notice Allocation staking address
    IAllocationStaking public immutable stakingAddress;

    /// @notice Farm lens address to get tokens price
    IFarmLensV2 public immutable farmLensV2Address;

    /// @notice Is address fix its staking allocation
    mapping(address => bool) public addressStakingAllocation;

    /// @notice Is address fix its lottery allocation
    mapping(address => bool) public addressLotteryAllocation;

    /// @notice Whitelist of tokens that can be deposited
    mapping(address => bool) public depositWhitelistAddresses;

    /// @notice Array of tokens that can be deposited
    address[] public allDepositWhitelistAddresses;

    /// @notice Precision rate for math operations
    uint256 public constant precisionRate = 100;

    /// @notice Token price in AVAT
    uint256 public tokenPriceInUSD;

    /// @notice Distribution periods with 'timestamp' and 'percent'
    DistributionPeriod[] private _distributionPeriods;

    /// @notice Addresses with distribution data of 'amount' and 'isClaimed' bool
    mapping(address => DistributionAddress[]) private _distributionAddresses;

    struct DistributionPeriod {
        uint256 timestamp;
        uint256 percent;
    }

    struct DistributionAddress {
        uint256 amount;
        bool isClaimed;
    }

    struct RoundDuration {
        uint256 startTime;
        uint256 endTime;
    }

    event SaleInitialized(address[] depositWhitelistAddresses, address token, uint256 startSale, uint256 endSale, uint256 tokenPriceInUSD, DistributionPeriod[] distributionPeriods);
    event DistributionPeriodsUpdated(DistributionPeriod[] distributionPeriods);
    event SalePeriodUpdated(uint256 startSale, uint256 endSale);
    event FCFSPeriodUpdated(uint256 startFCFS, uint256 endFCFS);
    event AllocationPeriodUpdated(uint256 startAllocation, uint256 endAllocation);
    event TransferPossibilityPeriodUpdated(uint256 start, uint256 end);
    event TokenRateUpdated(uint256 tokenPriceInUSD);
    event TokensBought(address buyer, uint256 sentAmount);
    event TokensClaimed(address claimer, uint256 periodId, uint256 receivedAmount);
    event AvatTokensCollected(address collector, uint256 amount);
    event SellingTokensCollected(address collector, uint256 amount);

    modifier onlyInitialized() {
        require(isInitialized, "Sale must be initialized");
        _;
    }

    constructor(
        address owner_,
        address signatory_,
        address stakingAddress_,
        address farmLensV2Address_,
        address sellingTokenAddress_,
        string memory name_,
        string memory symbol_
    ) SaleToken(name_, symbol_) {
        require(sellingTokenAddress_ != address(0), "C1");
        require(signatory_ != address(0), "C2");
        require(owner_ != address(0), "C3");
        require(stakingAddress_ != address(0), "C4");
        require(farmLensV2Address_ != address(0), "C5");

        _transferOwnership(owner_);

        farmLensV2Address = IFarmLensV2(farmLensV2Address_);
        signatory = signatory_;
        sellingTokenAddress = IERC20Decimals(sellingTokenAddress_);
        stakingAddress = IAllocationStaking(stakingAddress_);
    }

    /**
     * @notice [OWNER ONLY] Initialize sale settings. Set `isInitialized` field to true
     * @param tokenPriceInUSD_ token price in AVAT token
     * @param sale_ start and end of sale
     * @param fcfs_ start and end of fcfs
     * @param distributionPeriods_ distribution periods
     */
    function initialize(
        address[] calldata depositWhitelistAddresses_,
        uint256 tokenPriceInUSD_,
        RoundDuration calldata allocation_,
        RoundDuration calldata sale_,
        RoundDuration calldata fcfs_,
        RoundDuration calldata transferPossibilityDate_,
        DistributionPeriod[] calldata distributionPeriods_
    ) external onlyOwner {
        require(isInitialized == false, "I1");
        require(block.timestamp < allocation_.startTime, "I2");

        require(allocation_.startTime < allocation_.endTime, "I3");
        require(allocation_.endTime < sale_.startTime, "I4");
        require(sale_.startTime < sale_.endTime, "I5");

        require(sale_.endTime < fcfs_.startTime, "I6");
        require(fcfs_.startTime < fcfs_.endTime, "I7");

        require(fcfs_.endTime < distributionPeriods_[0].timestamp, "I8");

        require(tokenPriceInUSD_ > 0, "I9");

        sale = sale_;
        fcfs = fcfs_;
        allocation = allocation_;

        _allowTransfer(transferPossibilityDate_.startTime, transferPossibilityDate_.endTime);

        tokenPriceInUSD = tokenPriceInUSD_;

        uint256 periodsLength = distributionPeriods_.length;
        uint256 amountPercent = 0;

        for (uint256 i = 0; i < periodsLength; i++) {
            amountPercent = amountPercent.add(distributionPeriods_[i].percent);
            _distributionPeriods.push(distributionPeriods_[i]);
        }

        require(amountPercent.div(precisionRate) == 100, "I10");

        isInitialized = true;

        for (uint256 i = 0; i < depositWhitelistAddresses_.length; i++) {
            depositWhitelistAddresses[depositWhitelistAddresses_[i]] = true;
            allDepositWhitelistAddresses.push(depositWhitelistAddresses_[i]);
        }

        emit SaleInitialized(depositWhitelistAddresses_, address(sellingTokenAddress), sale_.startTime, sale_.endTime, tokenPriceInUSD_, distributionPeriods_);
    }

    /**
     * @notice [OWNER ONLY] Update distribution periods
     * @param distributionPeriods_ new distribution periods
     */
    function updateDistributionPeriods(DistributionPeriod[] calldata distributionPeriods_) external onlyOwner onlyInitialized {
        require(block.timestamp < sale.startTime, "UDP1");
        require(sale.endTime < distributionPeriods_[0].timestamp, "UDP2");
        require(distributionPeriods_.length == _distributionPeriods.length, "UDP3");
        delete _distributionPeriods;

        uint256 periodsLength = distributionPeriods_.length;
        uint256 amountPercent = 0;

        for (uint256 i = 0; i < periodsLength; i++) {
            amountPercent = amountPercent.add(distributionPeriods_[i].percent);
            _distributionPeriods.push(distributionPeriods_[i]);
        }

        require(amountPercent.div(precisionRate) == 100, "UDP4");
        emit DistributionPeriodsUpdated(distributionPeriods_);
    }

    /**
     * @notice [OWNER ONLY] Update sale period
     * @param startSale_ start of sale in timestamp
     * @param endSale_ end of  sale in timestamp
     */
    function updateSalePeriod(uint256 startSale_, uint256 endSale_) external onlyOwner onlyInitialized {
        require(block.timestamp < sale.startTime, "USP1");
        require(startSale_ < endSale_, "USP2");
        require(endSale_ < _distributionPeriods[0].timestamp, "USP3");

        sale.startTime = startSale_;
        sale.endTime = endSale_;
        emit SalePeriodUpdated(startSale_, endSale_);
    }

    /**
     * @notice [OWNER ONLY] Update FCFS period
     * @param startFCFS_ start of FCFS in timestamp
     * @param endFCFS_ end of FCFS in timestamp
     */
    function updateFCFSPeriod(uint256 startFCFS_, uint256 endFCFS_) external onlyOwner onlyInitialized {
        require(block.timestamp < fcfs.startTime, "UFP1");
        require(startFCFS_ < endFCFS_, "UFP2");
        require(sale.endTime < startFCFS_, "UFP3");
        require(endFCFS_ < _distributionPeriods[0].timestamp, "UFP4");

        fcfs.startTime = startFCFS_;
        fcfs.endTime = endFCFS_;
        emit FCFSPeriodUpdated(startFCFS_, endFCFS_);
    }

    /**
     * @notice [OWNER ONLY] Update allocation period
     * @param startAllocation_ start of allocation in timestamp
     * @param endAllocation_ end of allocation in timestamp
     */
    function updateAllocationPeriod(uint256 startAllocation_, uint256 endAllocation_) external onlyOwner onlyInitialized {
        require(block.timestamp < allocation.startTime, "UAP1");
        require(startAllocation_ < endAllocation_, "UAP2");
        require(endAllocation_ < sale.startTime, "UAP3");

        allocation.startTime = startAllocation_;
        allocation.endTime = endAllocation_;
        _allowTransfer(startAllocation_, endAllocation_);
        emit AllocationPeriodUpdated(startAllocation_, endAllocation_);
    }

    /**
     * @notice [OWNER ONLY] Update Transfer possibilty periods
     * @param start_ start of transfering possibilty in timestamp
     * @param end_ start of transfering possibilty in timestamp
     */
    function updateTranferPossibilityPeriod(uint256 start_, uint256 end_) external onlyOwner onlyInitialized {
        _allowTransfer(start_, end_);
        emit TransferPossibilityPeriodUpdated(start_, end_);
    }

    /**
     * @notice [OWNER ONLY] Update token rate
     * @param tokenPriceInUSD_ Rate for buy token
     */
    function updateTokenRates(uint256 tokenPriceInUSD_) external onlyOwner onlyInitialized {
        require(tokenPriceInUSD_ > 0, "UTR1");

        tokenPriceInUSD = tokenPriceInUSD_;
        emit TokenRateUpdated(tokenPriceInUSD_);
    }

    /**
     * @notice Take iAVAT allocation from staking
     * @param to Address which get tokens
     */
    function takeStakingAllocation(address to) external onlyInitialized {
        require(block.timestamp >= allocation.startTime, "TSA1");
        require(block.timestamp <= allocation.endTime, "TSA2");

        uint256 iAvatamount = stakingAddress.getiAVATAmount(msg.sender);

        require(iAvatamount != 0, "TSA3");
        require(addressStakingAllocation[msg.sender] == false, "TSA4");

        addressStakingAllocation[msg.sender] = true;

        _mint(to, iAvatamount);
    }

    /**
     * @notice Take iAVAT allocation from lottery
     * @param to Address which get tokens
     */
    function takeLotteryAllocation(
        address to,
        uint256 tokenAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyInitialized {
        require(SaleLibrary.permitLotteryAllocation(signatory, msg.sender, tokenAmount, deadline, v, r, s), "TLA1");
        require(tokenAmount != 0, "TLA2");
        require(addressLotteryAllocation[msg.sender] == false, "TLA3");

        addressLotteryAllocation[msg.sender] = true;

        _mint(to, tokenAmount);
    }

    /**
     * @notice Buy token
     * @param depositAddress ERC20 Token address
     * @param amount The number of tokens that are approved
     */
    function buyToken(
        address depositAddress,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyInitialized {
        require(SaleLibrary.permitBuy(signatory, msg.sender, deadline, v, r, s), "BT0");
        require(block.timestamp >= sale.startTime, "BT1");
        require(block.timestamp <= sale.endTime, "BT2");
        require(amount > 0, "BT3");

        uint256 allocationAmount = balanceOf(msg.sender);
        require(allocationAmount != 0, "BT4");

        require(_isAddressInDepositWhitelist(depositAddress), "BT5");

        IERC20Decimals(depositAddress).safeTransferFrom(msg.sender, address(this), amount);

        uint256 amountOfSellingTokens = _getAmountOfSellingTokens(depositAddress, amount);
        require(totalTokensBuy.add(amountOfSellingTokens) <= sellingTokenAddress.balanceOf(address(this)), "BT6");

        uint256 usedAllocationPoint = totalSupply().mul(amountOfSellingTokens).div(sellingTokenAddress.balanceOf(address(this)));
        _burn(msg.sender, usedAllocationPoint);

        if (_distributionAddresses[msg.sender].length == 0) {
            participants = participants.add(1);
        }

        _createDistributionAddress(amountOfSellingTokens, msg.sender);

        totalTokensBuy = totalTokensBuy.add(amountOfSellingTokens);
        totalFundsCollected[depositAddress] = totalFundsCollected[depositAddress].add(amount);
        addressFundsCollected[msg.sender] = addressFundsCollected[msg.sender].add(amountOfSellingTokens);

        emit TokensBought(msg.sender, amount);
    }

    /**
     * @notice Buy token without any allocation (FCFS)
     * @param depositAddress ERC20 Token address
     * @param amount The number of tokens that are approved
     */
    function buyTokenOnFCFS(
        address depositAddress,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyInitialized {
        require(SaleLibrary.permitBuy(signatory, msg.sender, deadline, v, r, s), "BTOF0");
        require(block.timestamp >= fcfs.startTime, "BTOF1");
        require(block.timestamp <= fcfs.endTime, "BTOF2");
        require(amount > 0, "BTOF3");

        require(_isAddressInDepositWhitelist(depositAddress), "BTOF4");

        IERC20Decimals(depositAddress).safeTransferFrom(msg.sender, address(this), amount);

        uint256 amountOfSellingTokens = _getAmountOfSellingTokens(depositAddress, amount);
        require(totalTokensBuy.add(amountOfSellingTokens) <= sellingTokenAddress.balanceOf(address(this)), "BTOF5");

        if (_distributionAddresses[msg.sender].length == 0) {
            participants = participants.add(1);
        }

        _createDistributionAddress(amountOfSellingTokens, msg.sender);

        totalTokensBuy = totalTokensBuy.add(amountOfSellingTokens);
        totalFundsCollected[depositAddress] = totalFundsCollected[depositAddress].add(amount);
        addressFundsCollected[msg.sender] = addressFundsCollected[msg.sender].add(amountOfSellingTokens);

        emit TokensBought(msg.sender, amount);
    }

    /**
     * @notice Claim available tokens.
     * @param periodId_ Number of period
     */
    function claimToken(uint256 periodId_) external onlyInitialized {
        address participant = msg.sender;
        uint256 distributionAmount = _distributionAddresses[participant][periodId_].amount;

        require(_distributionAddresses[participant][periodId_].isClaimed == false && _distributionAddresses[participant][periodId_].amount != 0, "claimToken: Participant does not have funds for withdrawal");
        require(block.timestamp >= _distributionPeriods[periodId_].timestamp, "CT1");
        require(periodId_ < _distributionPeriods.length, "CT2");

        _distributionAddresses[participant][periodId_].isClaimed = true;
        sellingTokenAddress.safeTransfer(participant, distributionAmount);
        totalTokensClaim = totalTokensClaim.add(distributionAmount);

        emit TokensClaimed(participant, periodId_, distributionAmount);
    }

    /**
     * @notice [OWNER ONLY] Collect raised funds. No check for whitelist to be able to return randomly transfered tokens
     * @param depositAddress Deposit address
     * @param to_ Address which receive tokens
     * @param amount_ amount to withdraw
     */
    function collectRaisedTokens(
        address depositAddress,
        address to_,
        uint256 amount_
    ) external onlyOwner {
        require(address(sellingTokenAddress) != depositAddress, "CRT1");

        IERC20Decimals(depositAddress).safeTransfer(to_, amount_);
        emit AvatTokensCollected(to_, amount_);
    }

    /**
     * @notice [OWNER ONLY] Collect leftover
     * @param amount_ Available amount to withdraw
     * @param address_ Address owner
     */
    function collectLeftoverTokens(uint256 amount_, address address_) external onlyOwner onlyInitialized {
        require(sellingTokenAddress.balanceOf(address(this)).sub(totalTokensBuy.sub(totalTokensClaim)) >= amount_, "CLT1");
        sellingTokenAddress.safeTransfer(address_, amount_);
        emit SellingTokensCollected(address_, amount_);
    }

    /**
     * @notice Returns available allocation for participant in deposit token
     */
    function availableAllocationInDepositToken(address depositAddress, address participant) external view returns (uint256) {
        uint256 addressAvailableAllocationInSellingToken = availableAllocationInSellingToken(participant);
        uint256 depositTokenPriceInUSD = farmLensV2Address.getTokenPrice(depositAddress);
        uint256 sellingTokenDecimals = sellingTokenAddress.decimals();
        uint256 depositTokenDecimalsDiff = uint256(18).sub(IERC20Decimals(depositAddress).decimals());

        return addressAvailableAllocationInSellingToken.mul(tokenPriceInUSD).mul(1e18).div(10**sellingTokenDecimals).div(depositTokenPriceInUSD).div(10**depositTokenDecimalsDiff);
    }

    /**
     * @notice Returns available allocation for participant who has sale tokens
     */
    function availableAllocationInSellingToken(address participant) public view returns (uint256) {
        uint256 addressAllocationPoint = balanceOf(participant).mul(10**decimals()).div(totalSupply());
        return sellingTokenAddress.balanceOf(address(this)).mul(addressAllocationPoint).div(10**decimals());
    }

    /**
     * @notice Get total funds collected in USD
     */
    function totalFundsCollectedInUSD() external view returns (uint256 totalAmountInUSD) {
        for (uint256 i = 0; i < allDepositWhitelistAddresses.length; i++) {
            uint256 amount = totalFundsCollected[allDepositWhitelistAddresses[i]];
            uint256 decimals = IERC20Decimals(allDepositWhitelistAddresses[i]).decimals();

            totalAmountInUSD = totalAmountInUSD.add(amount.mul(farmLensV2Address.getTokenPrice(allDepositWhitelistAddresses[i])).div(10**decimals));
        }
    }

    /**
     * @notice Get distribution for address
     * @param participant_ User who is allowed to purchase
     */
    function getDistributionAddress(address participant_) external view returns (DistributionAddress[] memory) {
        return _distributionAddresses[participant_];
    }

    /**
     * @notice Get distribution periods number
     * @return length periods
     */
    function getDistributionPeriodsNumber() external view returns (uint256) {
        return _distributionPeriods.length;
    }

    /**
     * @notice Get array of distribution periods
     * @return array of distribution dates
     */
    function getDistributionPeriods() external view returns (DistributionPeriod[] memory) {
        return _distributionPeriods;
    }

    /**
     * @notice Get array of deposit whitelist addresses
     * @return array of deposit whitelist addresses
     */
    function getDepositWhitelistAddresses() external view returns (address[] memory) {
        return allDepositWhitelistAddresses;
    }

    /**
     * @notice Get amount of selling tokens from deposit tokens
     * @param depositAddress ERC20 Tokens address
     * @param amount Amount of tokens
     */
    function _getAmountOfSellingTokens(address depositAddress, uint256 amount) private view returns (uint256) {
        uint256 depositTokenPriceInUSD = farmLensV2Address.getTokenPrice(depositAddress);

        return amount.mul(depositTokenPriceInUSD).mul(10**sellingTokenAddress.decimals()).div(tokenPriceInUSD).div(10**IERC20Decimals(depositAddress).decimals());
    }

    /**
     * @notice Is address in deposit whitelist
     * @param depositAddress ERC20 Tokens address
     */
    function _isAddressInDepositWhitelist(address depositAddress) private view returns (bool) {
        return depositWhitelistAddresses[depositAddress];
    }

    /**
     * @notice Creates distribution for address
     * param amount_ Amount for buy token
     * param participant_ User who is allowed to purchase
     */
    function _createDistributionAddress(uint256 amount_, address participant_) internal {
        uint256 _amountPercent = 0;

        for (uint256 i = 0; i < _distributionPeriods.length; i++) {
            _amountPercent = amount_.mul(_distributionPeriods[i].percent).div(100).div(precisionRate);
            DistributionAddress memory distributionAddress = DistributionAddress({amount: _amountPercent, isClaimed: false});

            if (i < _distributionAddresses[participant_].length) {
                _distributionAddresses[participant_][i].amount = _distributionAddresses[participant_][i].amount.add(distributionAddress.amount);
            } else {
                _distributionAddresses[participant_].push(distributionAddress);
            }
        }
    }
}
