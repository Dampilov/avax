const { ethers, upgrades } = require("hardhat");
const { expect } = require("chai");
const ethUtil = require("ethereumjs-util");
const hre = require("hardhat");

describe("AllocationStaking", function () {
  let AdminFactory;
  let Admin;
  let AvatToken, AvatLP1, AvatLP2;
  let AllocationStaking;
  let AllocationStakingRewardsFactory;
  let DistributionFactory;
  let Distribution;
  let deployer, alice, bob;
  let startTimestamp;
  let rewardEmissions;
  let rewardChange;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const SECONDS_IN_DAY = 86400;
  const DIGITS = 6;

  const REWARDS_PER_SECOND = ethers.utils.parseUnits("0.1", DIGITS);
  const TOKENS_TO_ADD = ethers.utils.parseUnits("100000", DIGITS);
  const TOKENS_TO_SEND = ethers.utils.parseUnits("1000", DIGITS);
  const START_TIMESTAMP_DELTA = 600;
  const ALLOC_POINT = 1000;
  const DEPOSIT_FEE_PERCENT = 5;
  const DEPOSIT_FEE_PRECISION = 100;
  const DEPOSIT_FEE_POOL_SHARE_PERCENT = 25;
  const DEFAULT_DEPOSIT = ethers.utils.parseUnits("1000", DIGITS);
  const NUMBER_1E36 = "1000000000000000000000000000000000000";
  const DEFAULT_LP_APPROVAL = ethers.utils.parseUnits("10000", DIGITS);
  const DEFAULT_BALANCE_ALICE = ethers.utils.parseUnits("10000", DIGITS);
  const WITHDRAW_ALLOWED_DAYS = 3;
  const DEFAULT_LOCKUP = 30; // days
  const STAKING_LIFETIME = 1 * 365 * SECONDS_IN_DAY;
  const END_TIMESTAMP_DELTA = STAKING_LIFETIME;
  const REWARD_PRECISION = 1e12;
  const REWARD_CHANGE_DAYS = 180;

  const DEPLOYER_PRIVATE_KEY =
    "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  function generateSignature(digest, privateKey) {
    // prefix with "\x19Ethereum Signed Message:\n32"
    // Reference: https://github.com/OpenZeppelin/openzeppelin-contracts/issues/890
    const prefixedHash = ethUtil.hashPersonalMessage(ethUtil.toBuffer(digest));

    // sign message
    const { v, r, s } = ethUtil.ecsign(
      prefixedHash,
      Buffer.from(privateKey, "hex")
    );

    // generate signature by concatenating r(32), s(32), v(1) in this order
    // Reference: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/76fe1548aee183dfcc395364f0745fe153a56141/contracts/ECRecovery.sol#L39-L43
    const vb = Buffer.from([v]);
    const signature = Buffer.concat([r, s, vb]);

    return signature;
  }

  function signWithdrawal(user, pid, stakeIndex, amount, nonce) {
    // compute keccak256(abi.encodePacked(user, roundId, address(this)))
    const digest = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ["address", "uint256", "uint256", "uint256", "uint256"],
        [user, pid, stakeIndex, amount, nonce]
      )
    );

    return generateSignature(digest, DEPLOYER_PRIVATE_KEY);
  }

  async function getCurrentBlockTimestamp() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  }

  async function baseSetup(params) {
    await AllocationStaking.add(ALLOC_POINT, AvatLP1.address, false);
  }

  async function baseSetupTwoPools(params) {
    await AllocationStaking.setDepositFee(
      DEPOSIT_FEE_PERCENT,
      DEPOSIT_FEE_PRECISION
    );

    await AllocationStaking.add(ALLOC_POINT, AvatLP1.address, false);
    await AllocationStaking.add(ALLOC_POINT, AvatLP2.address, false);

    await AvatLP1.approve(AllocationStaking.address, DEFAULT_LP_APPROVAL);
    await AvatLP1.connect(alice).approve(
      AllocationStaking.address,
      DEFAULT_LP_APPROVAL
    );
    await AvatLP1.connect(bob).approve(
      AllocationStaking.address,
      DEFAULT_LP_APPROVAL
    );

    await AvatLP2.approve(AllocationStaking.address, DEFAULT_LP_APPROVAL);
    await AvatLP2.connect(alice).approve(
      AllocationStaking.address,
      DEFAULT_LP_APPROVAL
    );
    await AvatLP2.connect(bob).approve(
      AllocationStaking.address,
      DEFAULT_LP_APPROVAL
    );

    await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
  }

  function computeExpectedReward(
    timestampNow,
    lastTimestamp,
    rewPerSec,
    poolAlloc,
    totalAlloc,
    poolDeposit
  ) {
    const tnow = ethers.BigNumber.from(timestampNow);
    // console.log(parseInt(tnow));
    const tdif = tnow.sub(lastTimestamp);
    // console.log(parseInt(tdif));
    const totalRewards = tdif.mul(rewPerSec);
    // console.log(parseInt(totalRewards));
    const poolRewards = totalRewards.mul(poolAlloc).div(totalAlloc);
    // console.log(parseInt(poolRewards));
    const poolRewardsPerShare = poolRewards.mul(NUMBER_1E36).div(poolDeposit);
    // console.log(parseInt(poolRewardsPerShare));

    return poolRewardsPerShare;
  }

  function takeFeeFromDeposit(deposit) {
    const depositBN = ethers.BigNumber.from(deposit);
    return depositBN.sub(
      depositBN.mul(DEPOSIT_FEE_PERCENT).div(DEPOSIT_FEE_PRECISION)
    );
  }

  beforeEach(async function () {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    alice = accounts[1];
    bob = accounts[2];

    AdminFactory = await ethers.getContractFactory("Admin");
    Admin = await AdminFactory.deploy([
      deployer.address,
      alice.address,
      bob.address,
    ]);

    const AvatTokenFactory = await ethers.getContractFactory("AvatToken");
    AvatToken = await AvatTokenFactory.deploy(
      "Avat",
      "Avat",
      ethers.utils.parseUnits("1000000", DIGITS),
      ethers.utils.parseUnits("100000000", DIGITS)
    );

    AvatLP1 = AvatToken;
    AvatLP2 = await AvatTokenFactory.deploy(
      "AvatLP2",
      "AvatLP2",
      ethers.utils.parseUnits("1000000", DIGITS),
      ethers.utils.parseUnits("100000000", DIGITS)
    );

    AllocationStakingRewardsFactory = await ethers.getContractFactory(
      "AllocationStaking"
    );
    const blockTimestamp = await getCurrentBlockTimestamp();
    startTimestamp = blockTimestamp + START_TIMESTAMP_DELTA;

    rewardChange = blockTimestamp + REWARD_CHANGE_DAYS * SECONDS_IN_DAY;
    const rewardAmount = REWARDS_PER_SECOND.mul(2).mul(REWARD_PRECISION);
    rewardEmissions = [
      [blockTimestamp, rewardChange, rewardAmount],
      [
        rewardChange + 1,
        rewardChange + 360 * SECONDS_IN_DAY,
        rewardAmount.mul(2),
      ],
    ];

    DistributionFactory = await ethers.getContractFactory("DistributionV2");
    Distribution = await hre.upgrades.deployProxy(DistributionFactory, [
      AvatToken.address,
      rewardEmissions,
    ]);
    AvatToken.transferOwnership(Distribution.address);

    AllocationStaking = await AllocationStakingRewardsFactory.deploy();
    await AllocationStaking.initialize(
      AvatToken.address,
      Distribution.address,
      startTimestamp,
      DEPOSIT_FEE_PERCENT,
      DEPOSIT_FEE_PRECISION,
      DEPOSIT_FEE_POOL_SHARE_PERCENT,
      WITHDRAW_ALLOWED_DAYS
    );

    await Admin.addAdmin(AllocationStaking.address);

    await AllocationStaking.setAdmin(Admin.address);

    await AllocationStaking.setDepositFee(
      DEPOSIT_FEE_PERCENT,
      DEPOSIT_FEE_PRECISION
    );

    await Distribution.mintTokens(alice.address, DEFAULT_BALANCE_ALICE);
    await Distribution.setPool(AllocationStaking.address, 50);
    await Distribution.addAdmin(AllocationStaking.address);

    await AvatLP2.transfer(alice.address, DEFAULT_BALANCE_ALICE);
  });

  context("Setup", async function () {
    it("Should setup the token correctly", async function () {
      // When
      let decimals = await AvatToken.decimals();
      let totalSupply = await AvatToken.totalSupply();
      let deployerBalance = await AvatToken.balanceOf(deployer.address);

      // Then
      expect(decimals).to.equal(6);
      expect(totalSupply).to.equal(
        ethers.utils.parseUnits("1000000", DIGITS).add(DEFAULT_BALANCE_ALICE)
      );
      expect(ethers.utils.parseUnits("1000000", DIGITS)).to.equal(
        deployerBalance
      );
    });

    it("Should setup the reward contract with no pools", async function () {
      // When
      let poolLength = await AllocationStaking.poolLength();
      let distribution = await AllocationStaking.distribution();
      let owner = await AllocationStaking.owner();
      let missedRewards = await AllocationStaking.missedRewards();

      // Then
      expect(poolLength).to.equal(0);
      expect(distribution).to.equal(Distribution.address);
      expect(owner).to.equal(deployer.address);
      expect(missedRewards).to.equal(0);
    });

    it("Should add a pool successfully", async function () {
      // When
      await AllocationStaking.add(ALLOC_POINT, AvatToken.address, false);

      // Then
      let poolLength = await AllocationStaking.poolLength();
      let totalAllocPoint = await AllocationStaking.totalAllocPoint();

      expect(poolLength).to.equal(1);
      expect(totalAllocPoint).to.equal(ALLOC_POINT);
    });

    it("Should add a pool successfully with mass update", async function () {
      // When
      await AllocationStaking.add(ALLOC_POINT, AvatToken.address, true);

      // Then
      let poolLength = await AllocationStaking.poolLength();
      let totalAllocPoint = await AllocationStaking.totalAllocPoint();

      expect(poolLength).to.equal(1);
      expect(totalAllocPoint).to.equal(ALLOC_POINT);
    });

    describe("Deposit fee", async function () {
      it("Should set a deposit fee and precision", async function () {
        // When
        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );

        // Then
        expect(await AllocationStaking.depositFeePercent()).to.equal(
          DEPOSIT_FEE_PERCENT
        );
        expect(await AllocationStaking.depositFeePrecision()).to.equal(
          DEPOSIT_FEE_PRECISION
        );
      });

      it("Should set the deposit fee to 0", async function () {
        // When
        await AllocationStaking.setDepositFee(0, 0);

        // Then
        expect(await AllocationStaking.depositFeePercent()).to.equal(0);
      });

      it("Should not allow non-owner to set deposit fee ", async function () {
        // Then
        await expect(
          AllocationStaking.connect(alice).setDepositFee(10, 10e7)
        ).to.be.reverted;
      });

      it("Should not allow to violate deposit fee constraint", async function () {
        // Then
        await expect(AllocationStaking.setDepositFee(100, 10)).to.be.reverted;
        await expect(AllocationStaking.setDepositFee(1, 1000)).to.be.reverted;
      });

      it("Should emit DepositFeeSet event", async function () {
        await expect(
          AllocationStaking.setDepositFee(
            DEPOSIT_FEE_PERCENT,
            DEPOSIT_FEE_PRECISION
          )
        )
          .to.emit(AllocationStaking, "DepositFeeSet")
          .withArgs(DEPOSIT_FEE_PERCENT, DEPOSIT_FEE_PRECISION);
      });
    });
  });

  context("Pools", async function () {
    describe("Add pools", async function () {
      it("Should add pool to list", async function () {
        // When
        await AllocationStaking.add(ALLOC_POINT, AvatLP1.address, false);

        // Then
        const poolLength = await AllocationStaking.poolLength();
        const pool = await AllocationStaking.poolInfo(0);

        expect(poolLength).to.equal(1);
        expect(pool.lpToken).to.equal(AvatLP1.address);
        expect(pool.allocPoint).to.equal(ALLOC_POINT);
        expect(pool.lastRewardTimestamp).to.equal(startTimestamp);
        expect(pool.accERC20PerShare).to.equal(0);
        expect(pool.totalDeposits).to.equal(0);

        expect(await AllocationStaking.totalAllocPoint()).to.equal(ALLOC_POINT);
      });

      it("Should add two pools to list", async function () {
        // When
        await AllocationStaking.add(ALLOC_POINT, AvatLP1.address, false);
        await AllocationStaking.add(ALLOC_POINT, AvatLP2.address, false);

        // Then
        const poolLength = await AllocationStaking.poolLength();
        const pool1 = await AllocationStaking.poolInfo(0);
        const pool2 = await AllocationStaking.poolInfo(1);

        expect(poolLength).to.equal(2);

        expect(pool1.lpToken).to.equal(AvatLP1.address);
        expect(pool1.allocPoint).to.equal(ALLOC_POINT);
        expect(pool1.lastRewardTimestamp).to.equal(startTimestamp);
        expect(pool1.accERC20PerShare).to.equal(0);
        expect(pool1.totalDeposits).to.equal(0);

        expect(pool2.lpToken).to.equal(AvatLP2.address);
        expect(pool2.allocPoint).to.equal(ALLOC_POINT);
        expect(pool2.lastRewardTimestamp).to.equal(startTimestamp);
        expect(pool2.accERC20PerShare).to.equal(0);
        expect(pool2.totalDeposits).to.equal(0);

        expect(await AllocationStaking.totalAllocPoint()).to.equal(
          2 * ALLOC_POINT
        );
      });

      it("Should not allow non-owner to add pool", async function () {
        // Then
        await expect(
          AllocationStaking.connect(alice).add(
            ALLOC_POINT,
            AvatLP1.address,
            false
          )
        ).to.be.reverted;
      });

      it("Should only allow the first pool's lp token to be reward token", async function () {
        // Then
        await expect(
          AllocationStaking.add(ALLOC_POINT, AvatLP2.address, false)
        ).to.be.revertedWith("First pool's lp token must be a reward token");
        await AllocationStaking.add(ALLOC_POINT, AvatLP1.address, false);
      });
    });

    describe("Set allocation point", async function () {
      it("Should set pool's allocation point", async function () {
        // Given
        await baseSetup();
        const newAllocPoint = 12345;

        // When
        await AllocationStaking.setAllocation(0, newAllocPoint, false);

        // Then
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.allocPoint).to.equal(newAllocPoint);
        expect(await AllocationStaking.totalAllocPoint()).to.equal(
          newAllocPoint
        );
      });

      it("Should set pool's allocation point with mass update", async function () {
        // Given
        await baseSetup();
        const newAllocPoint = 12345;

        // When
        await AllocationStaking.setAllocation(0, newAllocPoint, true);

        // Then
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.allocPoint).to.equal(newAllocPoint);
        expect(await AllocationStaking.totalAllocPoint()).to.equal(
          newAllocPoint
        );
      });

      it("Should set pool's allocation point to 0", async function () {
        // Given
        await baseSetup();
        const newAllocPoint = 0;

        // When
        await AllocationStaking.setAllocation(0, newAllocPoint, false);

        // Then
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.allocPoint).to.equal(newAllocPoint);
        expect(await AllocationStaking.totalAllocPoint()).to.equal(
          newAllocPoint
        );
      });

      it("Should not allow non-owner to set allocation point", async function () {
        // Given
        await baseSetup();
        const newAllocPoint = 12345;

        // Then
        await expect(
          AllocationStaking.connect(alice).setAllocation(
            0,
            newAllocPoint,
            false
          )
        ).to.be.reverted;
      });
    });

    describe("Update pool", async function () {
      it("Should update pool", async function () {
        // Given
        await baseSetup();

        await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.updatePool(0);

        // Then
        let blockTimestamp = await getCurrentBlockTimestamp();
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.lastRewardTimestamp).to.equal(blockTimestamp);
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(pool.accERC20PerShare).to.equal(expectedRewardsPerShare);
      });

      it("Should allow non-owner to update pool", async function () {
        // Given
        await baseSetup();

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(
          AllocationStaking.connect(alice).updatePool(0)
        ).to.not.be.reverted;

        const blockTimestamp = await getCurrentBlockTimestamp();
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.lastRewardTimestamp).to.equal(blockTimestamp);
      });

      it("Should only change timestamp if pool is empty", async function () {
        // Given
        await baseSetup();

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        const prevPoolInfo = await AllocationStaking.poolInfo(0);
        expect(prevPoolInfo.totalDeposits).to.equal(0);

        // When
        await AllocationStaking.updatePool(0);

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const pool = await AllocationStaking.poolInfo(0);
        expect(pool.lastRewardTimestamp).to.equal(blockTimestamp);
        expect(pool.accERC20PerShare).to.equal(0);
      });
    });

    describe("Mass update pools", async function () {
      it("Should update all pools", async function () {
        // Given
        await baseSetup();

        await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await AllocationStaking.add(ALLOC_POINT, AvatLP2.address, false);
        await AvatLP2.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.massUpdatePools();

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const pool1 = await AllocationStaking.poolInfo(0);
        const pool2 = await AllocationStaking.poolInfo(1);
        expect(pool1.lastRewardTimestamp).to.equal(blockTimestamp);
        expect(pool2.lastRewardTimestamp).to.equal(blockTimestamp);
        const expectedRewardsPerShare1 = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        const expectedRewardsPerShare2 = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          DEFAULT_DEPOSIT
        );
        expect(pool1.accERC20PerShare).to.equal(expectedRewardsPerShare1);
        expect(pool2.accERC20PerShare).to.equal(expectedRewardsPerShare2);
      });

      it("Should allow non-owner to mass update pools", async function () {
        // Given
        await baseSetup();

        await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await AllocationStaking.add(ALLOC_POINT, AvatLP2.address, false);
        await AvatLP2.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(
          AllocationStaking.connect(alice).massUpdatePools()
        ).to.not.be.reverted;
      });

      it("Should not break if array of pools is empty", async function () {
        // Given
        await AvatToken.approve(AllocationStaking.address, TOKENS_TO_ADD);

        // Then
        await expect(
          AllocationStaking.connect(alice).massUpdatePools()
        ).to.not.be.reverted;
      });
    });
    describe("Unique users", async function () {
      it("Should show correct amount of unique users", async function () {
        // Given
        await baseSetupTwoPools();

        await Distribution.mintTokens(bob.address, DEFAULT_BALANCE_ALICE);
        await AvatToken.connect(bob).approve(
          AllocationStaking.address,
          DEFAULT_LP_APPROVAL
        );

        // When
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        await AllocationStaking.connect(alice).deposit(
          0,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );
        await AllocationStaking.connect(bob).deposit(
          0,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );
        await AllocationStaking.connect(alice).deposit(
          0,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );

        // Then
        const poolInfo = await AllocationStaking.poolInfo(0);
        const uniqueUsers = poolInfo.uniqueUsers;
        expect(uniqueUsers).to.equal(3);
      });
      it("Should not change amount of unique users on withdraw", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.connect(alice).deposit(
          0,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.withdraw(0, 0);
        await AllocationStaking.connect(alice).withdraw(0, 0);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        // Then
        const poolInfo = await AllocationStaking.poolInfo(0);
        const uniqueUsers = poolInfo.uniqueUsers;
        expect(uniqueUsers).to.equal(2);
      });
      describe("APR", async function () {
        it("Should compute APR correctly", async function () {
          // Given
          await baseSetupTwoPools();
          await AvatToken.connect(alice).approve(
            AllocationStaking.address,
            DEFAULT_BALANCE_ALICE
          );
          await AllocationStaking.connect(alice).deposit(
            0,
            DEFAULT_BALANCE_ALICE,
            60
          );
          await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, 60);

          // When
          const blockTimestamp = await getCurrentBlockTimestamp();
          const APR = await AllocationStaking.getPoolAPR(0);

          const yearSeconds = 365 * SECONDS_IN_DAY;
          await ethers.provider.send("evm_increaseTime", [yearSeconds]);
          await ethers.provider.send("evm_mine");

          // Then
          const poolInfo = await AllocationStaking.poolInfo(0);
          const totalDeposits = poolInfo.totalDeposits;

          const secondsBeforeChange = rewardChange - blockTimestamp;
          const secondsAfterChange = yearSeconds - secondsBeforeChange;

          const rewardAccrued = REWARDS_PER_SECOND.mul(secondsBeforeChange).add(
            REWARDS_PER_SECOND.mul(2).mul(secondsAfterChange)
          );
          const expectedAPR = rewardAccrued
            .mul(ALLOC_POINT)
            .div(ALLOC_POINT * 2)
            .mul(10000)
            .div(totalDeposits);

          expect(APR).to.equal(expectedAPR);

          const expectedPending = takeFeeFromDeposit(DEFAULT_DEPOSIT)
            .mul(APR)
            .div(10000);
          const deviation = expectedPending.div(10);
          const pending = await AllocationStaking.pending(
            0,
            deployer.address,
            1
          );
          expect(pending).to.be.within(
            expectedPending.sub(deviation),
            expectedPending.add(deviation)
          );
        });
      });
    });
  });

  context("Deposits", async function () {
    describe("Deposited", async function () {
      it("Should have positive amount of stakes after a deposit", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const stakes = await AllocationStaking.userStakesCount(
          0,
          deployer.address
        );
        expect(stakes).to.equal(1);
      });

      it("Should return user amount deposited in pool", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const deposited = await AllocationStaking.deposited(
          0,
          deployer.address,
          0
        );
        expect(deposited).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
      });

      it("Should return total user amount deposited in pool", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const deposited = await AllocationStaking.totalDeposited(
          0,
          deployer.address
        );
        expect(deposited).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
      });

      it("Should return 0 if user not participated in pool", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const deposited = await AllocationStaking.totalDeposited(
          1,
          deployer.address
        );
        expect(deposited).to.equal(0);
      });

      it("Should return error if user not participated in pool", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        await expect(
          AllocationStaking.deposited(0, deployer.address, 1)
        ).to.be.revertedWith("Stake with this id does not exist");
      });
    });

    describe("Pending", async function () {
      it("Should return 0 if user deposited but staking not started", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const pending = await AllocationStaking.pending(0, deployer.address, 0);

        // Then
        expect(pending).to.equal(0);
      });

      it("Should fail if user didn't deposit", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.pending(0, deployer.address, 1)
        ).to.be.revertedWith("Stake with this id does not exist");
      });

      it("Should return 0 if user didn't deposit and staking not started", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const pending = await AllocationStaking.totalPending(
          1,
          deployer.address
        );

        // Then
        expect(pending).to.equal(0);
      });

      it("Should return 0 if staking started but user didn't deposit", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const pending = await AllocationStaking.totalPending(
          1,
          deployer.address
        );

        // Then
        expect(pending).to.equal(0);
      });

      it("Should return user's pending amount if staking started and user deposited", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.totalPending(
          0,
          deployer.address
        );

        // Then
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(pending).to.equal(
          expectedRewardsPerShare
            .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .div(NUMBER_1E36)
        );
      });

      it("Should return user's pending amount if called right after an update", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.updatePool(0);
        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.pending(0, deployer.address, 0);

        // Then
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(pending).to.equal(
          expectedRewardsPerShare
            .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .div(NUMBER_1E36)
        );
      });

      it("Should return user's pending amount if called some time after an update", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.updatePool(0);

        await ethers.provider.send("evm_increaseTime", [20]);
        await ethers.provider.send("evm_mine");

        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.pending(0, deployer.address, 0);

        // Then
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(pending).to.equal(
          expectedRewardsPerShare
            .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .div(NUMBER_1E36)
        );
      });

      it("Should return user's last pending amount if user deposited multiple times", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        const blockTimestampAtLastDeposit = await getCurrentBlockTimestamp();

        await ethers.provider.send("evm_increaseTime", [20]);
        await ethers.provider.send("evm_mine");

        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.pending(0, deployer.address, 2);

        // Then
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          blockTimestampAtLastDeposit,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT.mul(3))
        );

        // TODO: Check pending - adding 1
        expect(pending).to.equal(
          expectedRewardsPerShare
            .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .div(NUMBER_1E36)
            .add(1)
        );
      });

      it("Should compute reward debt properly if user is not first to stake in pool", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        await AllocationStaking.connect(alice).deposit(
          1,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );
        const blockTimestampAtLastDeposit = await getCurrentBlockTimestamp();

        await ethers.provider.send("evm_increaseTime", [20]);
        await ethers.provider.send("evm_mine");

        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.pending(1, alice.address, 0);

        // Then
        const prevExpectedRewardsPerShare = computeExpectedReward(
          blockTimestampAtLastDeposit,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          DEFAULT_DEPOSIT
        );
        const stake = await AllocationStaking.getUserStake(1, alice.address, 0);
        expect(stake.rewardDebt).to.equal(
          prevExpectedRewardsPerShare
            .mul(DEFAULT_DEPOSIT)
            .div(NUMBER_1E36) /* + firstRewardDebt*/
        );

        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          blockTimestampAtLastDeposit,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          2 * DEFAULT_DEPOSIT
        );
        expect(pending).to.equal(
          expectedRewardsPerShare.mul(DEFAULT_DEPOSIT).div(NUMBER_1E36)
        );
      });

      it("Should compute reward debt properly if user is not first to stake in pool but staking not started", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        // When
        await AllocationStaking.connect(alice).deposit(
          1,
          DEFAULT_DEPOSIT,
          DEFAULT_LOCKUP
        );

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        const blockTimestamp = await getCurrentBlockTimestamp();
        const pending = await AllocationStaking.pending(1, alice.address, 0);

        // Then
        const stake = await AllocationStaking.getUserStake(1, alice.address, 0);
        expect(stake.rewardDebt).to.equal(0);

        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          2 * DEFAULT_DEPOSIT
        );
        expect(pending).to.equal(
          expectedRewardsPerShare.mul(DEFAULT_DEPOSIT).div(NUMBER_1E36)
        );
      });
    });

    describe("Total pending", async function () {
      it("Should return total amount pending", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const blockTimestamp = await getCurrentBlockTimestamp();
        const totalPending = await AllocationStaking.totalPoolPending();

        // Then
        const expectedTotalPending = ethers.BigNumber.from(blockTimestamp)
          .sub(startTimestamp)
          .mul(REWARDS_PER_SECOND);
        expect(totalPending).to.equal(expectedTotalPending);
      });

      it("Should be sum of pending for each pool if multiple pools", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const blockTimestamp = await getCurrentBlockTimestamp();
        const totalPending = await AllocationStaking.totalPoolPending();

        const pending0 = await AllocationStaking.totalPending(
          0,
          deployer.address
        );
        const pending1 = await AllocationStaking.totalPending(
          1,
          deployer.address
        );

        // Then
        const expectedTotalPending = pending0.add(pending1);
        // TODO: Recheck

        expect(totalPending).to.equal(expectedTotalPending.add(1));
      });

      it("Should be sum of pending for each user if multiple users", async function () {
        // Given
        await baseSetup();

        await AvatLP1.connect(alice).approve(
          AllocationStaking.address,
          DEFAULT_LP_APPROVAL
        );
        await AllocationStaking.connect(alice).deposit(0, 250, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const totalPending = await AllocationStaking.totalPoolPending();

        const pendingDeployer = await AllocationStaking.totalPending(
          0,
          deployer.address
        );
        const pendingAlice = await AllocationStaking.totalPending(
          0,
          alice.address
        );

        // Then
        const expectedTotalPending = pendingDeployer.add(pendingAlice);
        // TODO: Recheck
        expect(totalPending).to.equal(expectedTotalPending.add(1));
      });

      //TODO:
      it("Should be sum of pending for each pool and user if multiple pools and users", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.deposit(0, 100, DEFAULT_LOCKUP);
        await AllocationStaking.connect(alice).deposit(0, 250, DEFAULT_LOCKUP);
        await AllocationStaking.connect(alice).deposit(1, 2500, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [100]);
        await ethers.provider.send("evm_mine");

        // When
        const blockTimestamp = await getCurrentBlockTimestamp();
        const totalPending = await AllocationStaking.totalPoolPending();

        const pendingDeployer0 = await AllocationStaking.totalPending(
          0,
          deployer.address
        );
        const pendingDeployer1 = await AllocationStaking.totalPending(
          1,
          deployer.address
        );
        const pendingAlice0 = await AllocationStaking.totalPending(
          0,
          alice.address
        );
        const pendingAlice1 = await AllocationStaking.totalPending(
          1,
          alice.address
        );

        // Then
        const expectedTotalPending = pendingDeployer0
          .add(pendingDeployer1)
          .add(pendingAlice0)
          .add(pendingAlice1);
        expect(totalPending).to.equal(expectedTotalPending.sub(1));
      });

      it("Should return 0 if staking not started", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const totalPending = await AllocationStaking.totalPoolPending();

        // Then
        expect(totalPending).to.equal(0);
      });

      it("Should return 0 if all pending tokens have been paid", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await ethers.provider.send("evm_setAutomine", [false]);
        await AllocationStaking.withdraw(0, 0);
        await AllocationStaking.withdraw(1, 0);
        await ethers.provider.send("evm_mine");
        await ethers.provider.send("evm_setAutomine", [true]);

        // When
        const totalPending = await AllocationStaking.totalPoolPending();

        // Then
        expect(totalPending).to.equal(1);
      });

      it("Should return correct amount if one pool is empty", async function () {
        // Given
        await baseSetupTwoPools();

        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        // When
        const blockTimestamp = await getCurrentBlockTimestamp();
        await AllocationStaking.massUpdatePools();
        const totalPending = await AllocationStaking.totalPoolPending();
        const pendingInPool0 = await AllocationStaking.totalPending(
          0,
          deployer.address
        );
        const pendingInPool1 = await AllocationStaking.totalPending(
          1,
          deployer.address
        );

        // Then
        expect(pendingInPool0).to.not.equal(0);
        expect(pendingInPool1).to.equal(0);

        expect(totalPending).to.equal(pendingInPool0.add(1));
      });
    });

    describe("Deposit", async function () {
      it("Should deposit LP tokens in pool if user is first to deposit", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);

        // Then
        const pool = await AllocationStaking.poolInfo(1);
        const user = await AllocationStaking.userInfo(1, deployer.address);
        expect(pool.totalDeposits).to.equal(250);
        expect(user.totalAmount).to.equal(250);
      });

      it("Should deposit LP tokens in pool if user is already deposited in this pool", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        const deposit = ethers.utils.parseUnits("250", DIGITS);
        await AllocationStaking.deposit(0, deposit, DEFAULT_LOCKUP);

        // Then
        const pool = await AllocationStaking.poolInfo(0);
        const user = await AllocationStaking.userInfo(0, deployer.address);
        expect(pool.totalDeposits).to.equal(
          takeFeeFromDeposit(DEFAULT_DEPOSIT.add(deposit))
        );
        expect(user.totalAmount).to.equal(
          takeFeeFromDeposit(DEFAULT_DEPOSIT.add(deposit))
        );
      });

      it("Should deposit LP tokens in pool if user is second to deposit", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);
        await AllocationStaking.connect(alice).deposit(1, 300, DEFAULT_LOCKUP);

        // Then
        const pool = await AllocationStaking.poolInfo(1);
        const user = await AllocationStaking.userInfo(1, alice.address);
        expect(pool.totalDeposits).to.equal(250 + 300);
        expect(user.totalAmount).to.equal(300);
      });

      it("Should update pool before adding LP tokens", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [START_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        // When
        const amount = ethers.utils.parseUnits("100", DIGITS);
        await AllocationStaking.deposit(1, amount, DEFAULT_LOCKUP);

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const pool = await AllocationStaking.poolInfo(1);
        expect(pool.lastRewardTimestamp).to.equal(blockTimestamp);
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          DEFAULT_DEPOSIT
        );
        expect(pool.accERC20PerShare).to.equal(expectedRewardsPerShare);
        expect(pool.totalDeposits).to.equal(DEFAULT_DEPOSIT.add(amount));
      });

      it("Should not deposit into non-existent pool", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.deposit(3, DEFAULT_DEPOSIT, DEFAULT_LOCKUP)
        ).to.be.revertedWith("Pool with such id does not exist");
      });

      it("Should not deposit zero amount", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.deposit(0, 0, DEFAULT_LOCKUP)
        ).to.be.revertedWith("Should deposit positive amount");
      });

      it("Should not deposit for incorrect period", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.deposit(0, DEFAULT_DEPOSIT, 42)
        ).to.be.revertedWith(
          "Stake duration must equal to 14, 30, 45 or 60 days"
        );
      });

      it("Should emit Deposit event", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP)
        )
          .to.emit(AllocationStaking, "Deposit")
          .withArgs(
            deployer.address,
            0,
            1,
            takeFeeFromDeposit(DEFAULT_DEPOSIT)
          );
      });
    });

    describe("Deposit fee", async function () {
      it("Should only redistribute Avat once", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );

        const totalAvatRedistributedBefore =
          await AllocationStaking.totalAvatRedistributed();
        const feeCollectedBefore =
          await AllocationStaking.depositFeeCollected();

        // When
        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);

        // Then
        const totalAvatRedistributedAfter =
          await AllocationStaking.totalAvatRedistributed();
        const feeCollectedAfter = await AllocationStaking.depositFeeCollected();

        const depositFee = ethers.BigNumber.from(amountToDeposit)
          .mul(DEPOSIT_FEE_PERCENT)
          .div(DEPOSIT_FEE_PRECISION);
        const poolShare = depositFee
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);
        const collectedShare = depositFee.sub(poolShare);

        expect(totalAvatRedistributedAfter).to.equal(
          totalAvatRedistributedBefore.add(poolShare)
        );
        expect(feeCollectedAfter).to.equal(
          feeCollectedBefore.add(collectedShare)
        );
      });

      it("Should redistribute Avat if deposit after stake ended", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );

        const totalAvatRedistributedBefore =
          await AllocationStaking.totalAvatRedistributed();

        // When
        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        await ethers.provider.send("evm_increaseTime", [END_TIMESTAMP_DELTA]);
        await ethers.provider.send("evm_mine");

        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);

        // Then
        const totalAvatRedistributedAfter =
          await AllocationStaking.totalAvatRedistributed();
        const depositFee = ethers.BigNumber.from(amountToDeposit)
          .mul(DEPOSIT_FEE_PERCENT)
          .div(DEPOSIT_FEE_PRECISION);
        const poolShare = depositFee
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);
        expect(totalAvatRedistributedAfter).to.equal(
          totalAvatRedistributedBefore.add(poolShare)
        );
      });

      it("Should redistribute Avat if deposit at same timestamp", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );

        const totalAvatRedistributedBefore =
          await AllocationStaking.totalAvatRedistributed();

        // When
        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);

        // Then
        const totalAvatRedistributedAfter =
          await AllocationStaking.totalAvatRedistributed();
        const depositFee = ethers.BigNumber.from(amountToDeposit)
          .mul(DEPOSIT_FEE_PERCENT)
          .div(DEPOSIT_FEE_PRECISION);
        const poolShare = depositFee
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);
        expect(totalAvatRedistributedAfter).to.equal(
          totalAvatRedistributedBefore.add(poolShare)
        );
      });

      it("Should not redistribute Avat if pool is empty", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 50,
        ]);
        await ethers.provider.send("evm_mine");

        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);

        const initialDepositFee =
          (DEFAULT_DEPOSIT * DEPOSIT_FEE_PERCENT) / DEPOSIT_FEE_PRECISION;
        const initialPoolShare = ethers.BigNumber.from(initialDepositFee)
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);
        // console.log(initialDepositFee);
        // Then
        const totalAvatRedistributedAfter =
          await AllocationStaking.totalAvatRedistributed();
        const depositFee = ethers.BigNumber.from(amountToDeposit)
          .mul(DEPOSIT_FEE_PERCENT)
          .div(DEPOSIT_FEE_PRECISION);
        const poolShare = depositFee
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);
        expect(totalAvatRedistributedAfter).to.equal(
          poolShare.add(initialPoolShare)
        );
      });

      it("Should emit FeeTaken event", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        const depositFee = ethers.BigNumber.from(DEFAULT_DEPOSIT)
          .mul(DEPOSIT_FEE_PERCENT)
          .div(DEPOSIT_FEE_PRECISION);
        const poolShare = depositFee
          .mul(DEPOSIT_FEE_POOL_SHARE_PERCENT)
          .div(100);

        await expect(
          AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP)
        )
          .to.emit(AllocationStaking, "FeeTaken")
          .withArgs(deployer.address, 0, depositFee, poolShare);
      });

      it("Should claim collected fees", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );
        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);
        const feeCollectedBefore =
          await AllocationStaking.depositFeeCollected();

        // When
        await AllocationStaking.claimCollectedFees(bob.address);

        // Then
        const bobBalance = await AvatToken.balanceOf(bob.address);
        expect(bobBalance).to.equal(feeCollectedBefore);

        const feeCollectedAfter = await AllocationStaking.depositFeeCollected();
        expect(feeCollectedAfter).to.equal(0);
      });

      it("Should not be able to claim collected fees twice", async function () {
        // Given
        await baseSetupTwoPools();

        await AllocationStaking.setDepositFee(
          DEPOSIT_FEE_PERCENT,
          DEPOSIT_FEE_PRECISION
        );
        const amountToDeposit = ethers.BigNumber.from("1000000000");
        await AvatLP1.approve(AllocationStaking.address, amountToDeposit);
        await AllocationStaking.deposit(0, amountToDeposit, DEFAULT_LOCKUP);

        // When
        await AllocationStaking.claimCollectedFees(bob.address);

        // Then
        await expect(
          AllocationStaking.claimCollectedFees(bob.address)
        ).to.be.revertedWith("Zero fees to collect");
      });

      it("Should get deposited amount from user", async () => {
        // Given
        await baseSetupTwoPools();

        // When
        await ethers.provider.send("evm_increaseTime", [600]);
        await ethers.provider.send("evm_mine");

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        let [deposits, earnings] =
          await AllocationStaking.getTotalPendingAndDepositedForUsers(
            [deployer.address],
            0
          );
        expect(deposits[0]).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(earnings[0]).to.equal(
          expectedRewardsPerShare
            .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .div(NUMBER_1E36)
        );
      });
    });
    describe("Stake multiplier", async function () {
      it("Should return correct stake multiplier", async function () {
        // Given
        const stake14 = await AllocationStaking.getStakeMultiplierPercent(14);
        const stake30 = await AllocationStaking.getStakeMultiplierPercent(30);
        const stake45 = await AllocationStaking.getStakeMultiplierPercent(45);
        const stake60 = await AllocationStaking.getStakeMultiplierPercent(60);
        // Then
        expect(stake14).to.equal(0);
        expect(stake30).to.equal(100);
        expect(stake45).to.equal(150);
        expect(stake60).to.equal(200);
      });
      it("Should fail call on incorrect stake periods", async function () {
        // Given
        await expect(
          AllocationStaking.getStakeMultiplierPercent(15)
        ).to.be.revertedWith(
          "Stake duration must equal to 14, 30, 45 or 60 days"
        );
        await expect(
          AllocationStaking.getStakeMultiplierPercent(31)
        ).to.be.revertedWith(
          "Stake duration must equal to 14, 30, 45 or 60 days"
        );
        await expect(
          AllocationStaking.getStakeMultiplierPercent(39)
        ).to.be.revertedWith(
          "Stake duration must equal to 14, 30, 45 or 60 days"
        );
        await expect(
          AllocationStaking.getStakeMultiplierPercent(125)
        ).to.be.revertedWith(
          "Stake duration must equal to 14, 30, 45 or 60 days"
        );
      });
      it("Should create a deposit with a correct multiplier", async function () {
        // Given
        await baseSetupTwoPools();
        // When
        await AllocationStaking.deposit(0, 100, 14);
        await AllocationStaking.deposit(0, 100, 30);
        await AllocationStaking.deposit(0, 100, 45);
        await AllocationStaking.deposit(0, 100, 60);
        // Then
        const stake14 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          1
        );
        const stake30 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          2
        );
        const stake45 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          3
        );
        const stake60 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          4
        );

        expect(stake14.stakeMultiplierPercent).to.equal(0);
        expect(stake30.stakeMultiplierPercent).to.equal(100);
        expect(stake45.stakeMultiplierPercent).to.equal(150);
        expect(stake60.stakeMultiplierPercent).to.equal(200);
      });
    });
    describe("Getters", async function () {
      it("Should get user's single stake", async function () {
        // Given
        await baseSetupTwoPools();
        const timestamp = await getCurrentBlockTimestamp();
        // Then
        const stake = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          0
        );
        expect(stake.id).to.equal(0);
        expect(stake.index).to.equal(0);
        expect(stake.amount).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
      });
      it("Should get user's multiple stakes", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, 60);
        // Then
        const stakes = await AllocationStaking.getUserStakes(
          0,
          deployer.address
        );
        const stake0 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          0
        );
        const stake1 = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          1
        );
        expect(stakes[0]).to.eql(stake0);
        expect(stakes[1]).to.eql(stake1);
      });
    });
  });

  context("Withdraws", async function () {
    describe("Withdraw", async function () {
      it("Should withdraw user's deposit", async function () {
        // Given
        await baseSetupTwoPools();
        const poolBefore = await AllocationStaking.poolInfo(0);
        const balanceBefore = await AvatLP1.balanceOf(deployer.address);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.withdraw(0, 0);

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const poolAfter = await AllocationStaking.poolInfo(0);
        const balanceAfter = await AvatLP1.balanceOf(deployer.address);

        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        const expectedReward = expectedRewardsPerShare
          .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
          .div(NUMBER_1E36);

        expect(balanceAfter).to.equal(
          balanceBefore
            .add(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .add(expectedReward)
        );
        expect(poolBefore.totalDeposits).to.equal(
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        expect(poolAfter.totalDeposits).to.equal(0);
      });

      it("Should not withdraw without user's deposit", async function () {
        // Given
        await baseSetupTwoPools();

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT) * 2;

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(
          AllocationStaking.connect(bob).withdraw(0, 0)
        ).to.be.revertedWith("Can't withdraw without an existing stake");
      });

      it("Should not withdraw before unlock time", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
          "Stake is not unlocked yet."
        );
      });

      it("Should transfer user's ERC20 share", async function () {
        // Given
        await baseSetupTwoPools();

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        const pendingBefore = await AllocationStaking.pending(
          0,
          deployer.address,
          0
        );
        const balanceERC20Before = await AvatToken.balanceOf(deployer.address);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        await AllocationStaking.withdraw(0, 0);

        // Then
        const pendingAfter = await AllocationStaking.pending(
          0,
          deployer.address,
          0
        );
        const balanceERC20After = await AvatToken.balanceOf(deployer.address);

        // For some reason block.timestamp in the pending() and withdraw() calls differs by 1 second.
        // This will compensate the reward discrepancy
        const totalAllocPoint = await AllocationStaking.totalAllocPoint();
        const timeCorrection =
          REWARDS_PER_SECOND.mul(ALLOC_POINT).div(totalAllocPoint);

        expect(balanceERC20After).to.equal(
          balanceERC20Before.add(pendingBefore).add(amount).add(timeCorrection)
        );
        expect(pendingAfter).to.equal(0);
        expect(await AllocationStaking.paidOut()).to.equal(
          pendingBefore.add(timeCorrection)
        );
      });

      it("Should emit Withdraw event", async function () {
        // Given
        await baseSetupTwoPools();

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp + 1,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          amount
        );
        const expectedReward = expectedRewardsPerShare
          .mul(amount)
          .div(NUMBER_1E36);

        await expect(AllocationStaking.withdraw(0, 0))
          .to.emit(AllocationStaking, "Withdraw")
          .withArgs(deployer.address, 0, 0, amount, expectedReward);
      });

      it("Should clear stake record after a full withdraw", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        const half = amount / 2;
        // Partial withdraw for a comparison
        const tx1 = await AllocationStaking.withdraw(0, 2);
        const receipt1 = await tx1.wait();
        // Full withdraw for a gas refund
        const tx2 = await AllocationStaking.withdraw(0, 1);
        const receipt2 = await tx2.wait();

        // Then
        const regularGas = receipt1.gasUsed;
        const refundedGas = receipt2.gasUsed;
        expect(regularGas.sub(refundedGas)).to.be.gt(10000);

        await expect(
          AllocationStaking.getUserStake(0, deployer.address, 1)
        ).to.be.revertedWith("Stake with this id does not exist");
      });

      it("Should push new stake record after the refund correctly", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        await AllocationStaking.deposit(0, 123, DEFAULT_LOCKUP);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Full withdraw for a gas refund
        await AllocationStaking.withdraw(0, 1);
        // Make a new deposit
        await AllocationStaking.deposit(0, 345, DEFAULT_LOCKUP);

        // Then
        await expect(
          AllocationStaking.getUserStake(0, deployer.address, 1)
        ).to.be.revertedWith("Stake with this id does not exist");
        const stake = await AllocationStaking.getUserStake(
          0,
          deployer.address,
          3
        );
        // Can delete this if stakes array shrinks on deletes (full withdraws)
        // and change arguments of the previous getUserStake
        expect(stake.index).to.equal(1);
        expect(stake.amount).to.equal(takeFeeFromDeposit(123));
        expect(stake.id).to.equal(3);

        const userIds = await AllocationStaking.getUserStakeIds(
          0,
          deployer.address
        );
        userIds.forEach(async (id, index) => {
          const userStake = await AllocationStaking.getUserStake(
            0,
            deployer.address,
            id
          );
          userStake.index.eq(id, index);
        });
      });

      it("Should revert on withdraw after the allowed window passed", async function () {
        // Given
        await baseSetupTwoPools();
        const poolBefore = await AllocationStaking.poolInfo(0);
        const balanceBefore = await AvatLP1.balanceOf(deployer.address);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS) * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
          "Can only withdraw during the allowed time window after the unlock"
        );
      });

      it("Should withdraw normally after the automatic relock passed", async function () {
        // Given
        await baseSetupTwoPools();
        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS) * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");
        await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
          "Can only withdraw during the allowed time window after the unlock"
        );

        const relockDays = await AllocationStaking.RELOCK_DAYS();
        await ethers.provider.send("evm_increaseTime", [
          relockDays * SECONDS_IN_DAY + 100,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(AllocationStaking.withdraw(0, 0));
      });

      it("Should revert on withdraw on the second relock also", async function () {
        // Given
        await baseSetupTwoPools();

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);

        // When
        await ethers.provider.send("evm_increaseTime", [
          (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS) * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
          "Can only withdraw during the allowed time window after the unlock"
        );
      });

      it("Should mint tokens on withdraw", async function () {
        // Given
        await baseSetupTwoPools();
        const balanceBefore = await AvatLP1.balanceOf(deployer.address);

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp + 1,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        const expectedReward = expectedRewardsPerShare
          .mul(takeFeeFromDeposit(DEFAULT_DEPOSIT))
          .div(NUMBER_1E36);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);
        const fee = DEFAULT_DEPOSIT.sub(amount).div(4);
        const expectedMint = expectedReward.sub(fee);
        await expect(AllocationStaking.withdraw(0, 0))
          .to.emit(Distribution, "MintTokens")
          .withArgs(AllocationStaking.address, expectedMint);

        const stakingSigner = await ethers.getSigner(AllocationStaking.address);
        const rewardAmount = await Distribution.connect(
          stakingSigner
        ).countRewardAmount(startTimestamp, blockTimestamp + 1);
        expect(expectedReward.add(1)).to.equal(
          rewardAmount.mul(ALLOC_POINT).div(2 * ALLOC_POINT)
        );

        const balanceAfter = await AvatLP1.balanceOf(deployer.address);
        expect(balanceAfter).to.equal(
          balanceBefore
            .add(takeFeeFromDeposit(DEFAULT_DEPOSIT))
            .add(expectedReward)
        );
      });

      it("Should also mint tokens on withdraw from secondary pool", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
        const balanceBeforeLP = await AvatLP2.balanceOf(deployer.address);

        const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);
        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");
        // This withdraw is here just to transfer out fees, collected in baseSetupTwoPools deposit call
        await AllocationStaking.withdraw(0, 0);
        const balanceBefore = await AvatToken.balanceOf(deployer.address);

        // Then
        const blockTimestamp = await getCurrentBlockTimestamp();
        const expectedRewardsPerShare = computeExpectedReward(
          blockTimestamp + 1,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          takeFeeFromDeposit(DEFAULT_DEPOSIT)
        );
        const expectedReward = expectedRewardsPerShare
          .mul(amount)
          .div(NUMBER_1E36)
          .add(1);

        await expect(AllocationStaking.withdraw(1, 0))
          .to.emit(Distribution, "MintTokens")
          .withArgs(AllocationStaking.address, expectedReward);

        const balanceAfterLP = await AvatLP2.balanceOf(deployer.address);
        expect(balanceAfterLP).to.equal(balanceBeforeLP.add(DEFAULT_DEPOSIT));
        const balanceAfter = await AvatToken.balanceOf(deployer.address);
        expect(balanceAfter).to.equal(balanceBefore.add(expectedReward));
      });
    });
  });

  describe("Collect", async function () {
    it("Should collect rewards before lockup time passed", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatToken.balanceOf(deployer.address);

      // When
      await ethers.provider.send("evm_increaseTime", [10 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.collect(0, 0);

      // Then
      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow,
        startTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      )
        .div(NUMBER_1E36)
        .sub(1);
      const balanceAfter = await AvatToken.balanceOf(deployer.address);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedReward));
    });

    it("Should collect rewards after lockup time passed", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatToken.balanceOf(deployer.address);

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.collect(0, 0);

      // Then
      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow,
        startTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      )
        .div(NUMBER_1E36)
        .sub(1);
      const balanceAfter = await AvatToken.balanceOf(deployer.address);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedReward));
    });

    it("Should emit event in collect rewards", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatToken.balanceOf(deployer.address);

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      // Then
      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow + 1,
        startTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      )
        .div(NUMBER_1E36)
        .sub(1);

      await expect(AllocationStaking.collect(0, 0))
        .to.emit(AllocationStaking, "Rewards")
        .withArgs(deployer.address, 0, 0, expectedReward);
    });

    it("Should collect rewards continuously correct", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatToken.balanceOf(deployer.address);

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.collect(0, 0);

      // Then
      const oneSecondReward = REWARDS_PER_SECOND.div(2);
      await expect(AllocationStaking.collect(0, 0))
        .to.emit(AllocationStaking, "Rewards")
        .withArgs(deployer.address, 0, 0, oneSecondReward);

      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow,
        startTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      )
        .div(NUMBER_1E36)
        .sub(1);
      const balanceAfter = await AvatToken.balanceOf(deployer.address);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedReward));
    });

    it("Should collect rewards again after some tome passes", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatToken.balanceOf(deployer.address);

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.collect(0, 0);
      const collectTimestamp = await getCurrentBlockTimestamp();

      await ethers.provider.send("evm_increaseTime", [10 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      // Then
      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow + 1,
        collectTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      ).div(NUMBER_1E36);
      await expect(AllocationStaking.collect(0, 0))
        .to.emit(AllocationStaking, "Rewards")
        .withArgs(deployer.address, 0, 0, expectedReward);
    });

    it("Should revet on collect without a deposit", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [10 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      // Then
      await expect(AllocationStaking.collect(1, 0)).to.be.revertedWith(
        "Can't withdraw without an existing stake"
      );
    });
  });

  describe("Restake", function () {
    it("Should revert on restake before the unlock", async function () {
      // Given
      await baseSetupTwoPools();

      // Then
      await expect(AllocationStaking.restake(0, 0, 45)).to.be.revertedWith(
        "Can't restake before the unlock time"
      );
    });

    it("Should restake before the unlock on 14 days stake", async function () {
      // Given
      await baseSetupTwoPools();
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, 14);

      // When
      await ethers.provider.send("evm_increaseTime", [4 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.restake(0, 1, 30);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        1
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 30 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(100);
    });

    it("Should revert on restake without a stake", async function () {
      // Given
      await baseSetupTwoPools();

      // Then
      await expect(AllocationStaking.restake(0, 1, 45)).to.be.revertedWith(
        "Stake with this id does not exist"
      );
      await expect(AllocationStaking.restake(1, 0, 45)).to.be.revertedWith(
        "Stake is empty"
      );
    });

    it("Should restake normally", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.restake(0, 0, 45);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 45 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(150);
    });

    it("Should emit Restake event", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      // Then
      const timestamp = await getCurrentBlockTimestamp();
      const unlockTime = timestamp + 45 * SECONDS_IN_DAY + 1;
      await expect(AllocationStaking.restake(0, 0, 45))
        .to.emit(AllocationStaking, "Restake")
        .withArgs(deployer.address, 0, 0, unlockTime);
    });

    it("Should restake to a lower time in the allowed window", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.restake(0, 0, 14);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 14 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(0);
    });

    it("Should restake to a lower time in the next allowed window", async function () {
      // Given
      await baseSetupTwoPools();
      const relockDays = await AllocationStaking.RELOCK_DAYS();

      // When
      await ethers.provider.send("evm_increaseTime", [
        (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS + relockDays.toNumber()) *
          SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      //await AllocationStaking.withdraw(0, 0);
      await AllocationStaking.restake(0, 0, 14);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 14 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(0);
    });

    it("Should restake to a lower time on automatic relock time", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS + 1) * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");
      await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
        "Can only withdraw during the allowed time window after the unlock"
      );

      await AllocationStaking.restake(0, 0, 14);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 14 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(0);
    });

    it("Should restake to a greater time on automatic relock time", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS + 1) * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");
      await expect(AllocationStaking.withdraw(0, 0)).to.be.revertedWith(
        "Can only withdraw during the allowed time window after the unlock"
      );

      await AllocationStaking.restake(0, 0, 45);

      // Then
      const stake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const timestamp = await getCurrentBlockTimestamp();

      expect(stake.tokensUnlockTime).to.equal(timestamp + 45 * SECONDS_IN_DAY);
      expect(stake.stakeMultiplierPercent).to.equal(150);
    });

    it("Should revert on restake right after restake", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.restake(0, 0, 45);

      // Then
      await expect(AllocationStaking.restake(0, 0, 30)).to.be.revertedWith(
        "Can't restake before the unlock time"
      );
    });
  });

  describe("Compound", function () {
    it("Should compound", async function () {
      // Given
      await baseSetupTwoPools();
      const balanceBefore = await AvatLP1.balanceOf(deployer.address);

      await ethers.provider.send("evm_increaseTime", [
        START_TIMESTAMP_DELTA + 10,
      ]);
      await ethers.provider.send("evm_mine");

      // Then
      const timestampNow = await getCurrentBlockTimestamp();
      const expectedReward = computeExpectedReward(
        timestampNow + 1,
        startTimestamp,
        REWARDS_PER_SECOND,
        ALLOC_POINT,
        2 * ALLOC_POINT,
        1
      ).div(NUMBER_1E36);
      const expectedCompound = takeFeeFromDeposit(expectedReward);
      const expectedStake =
        takeFeeFromDeposit(DEFAULT_DEPOSIT).add(expectedCompound);

      expect(await AllocationStaking.compound(0, 0))
        .to.emit(AllocationStaking, "CompoundedEarnings")
        .withArgs(deployer.address, 0, 0, expectedCompound, expectedStake);

      const userStake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const stakeAmount = userStake.amount;
      expect(stakeAmount).to.equal(expectedStake);

      const balanceAfter = await AvatLP1.balanceOf(deployer.address);
      expect(balanceAfter).to.equal(balanceBefore);
    });

    it("Should compound twice", async function () {
      // Given
      await baseSetupTwoPools();

      await ethers.provider.send("evm_increaseTime", [
        START_TIMESTAMP_DELTA + 10,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.compound(0, 0);
      const userStake = await AllocationStaking.getUserStake(
        0,
        deployer.address,
        0
      );
      const stakeAmount = userStake.amount;

      // Then
      const expectedReward = REWARDS_PER_SECOND.div(2);
      const expectedCompound = takeFeeFromDeposit(expectedReward);

      expect(await AllocationStaking.compound(0, 0))
        .to.emit(AllocationStaking, "CompoundedEarnings")
        .withArgs(
          deployer.address,
          0,
          0,
          expectedCompound,
          stakeAmount.add(expectedCompound)
        );
    });

    it("Should fail on compound in secondary pools", async function () {
      // Given
      await baseSetupTwoPools();
      await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await expect(AllocationStaking.compound(1, 0)).to.be.revertedWith(
        "Can only compound in the primary pool (_pid == 0)"
      );
    });

    it("Should fail on compound if has no stake", async function () {
      // Given
      await baseSetupTwoPools();

      await expect(
        AllocationStaking.connect(bob).compound(0, 0)
      ).to.be.revertedWith("User does not have anything staked");
      await expect(AllocationStaking.compound(0, 1)).to.be.revertedWith(
        "Stake with this id does not exist"
      );
    });

    it("Should fail if nothing to compound yet", async function () {
      // Given
      await baseSetupTwoPools();

      // Then
      await expect(AllocationStaking.compound(0, 0)).to.be.revertedWith(
        "Nothing to compound yet"
      );
    });

    it("Should collect normally after compound", async function () {
      // Given
      await baseSetupTwoPools();
      await AllocationStaking.connect(alice).deposit(
        0,
        DEFAULT_DEPOSIT,
        DEFAULT_LOCKUP
      );

      await ethers.provider.send("evm_increaseTime", [30 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.connect(alice).compound(0, 0);

      // Then
      await expect(AllocationStaking.collect(0, 0)).to.emit(
        AllocationStaking,
        "Rewards"
      );
    });
  });

  describe("iAVAT", async function () {
    it("Should calculate iAVAT amount for a default stake", async function () {
      // Given
      await baseSetupTwoPools();

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(deployer.address);
      expect(iavat).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
    });

    it("Should be zero iAVAT for a short stake", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await AllocationStaking.connect(alice).deposit(0, DEFAULT_DEPOSIT, 14);

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(alice.address);
      expect(iavat).to.equal(0);
    });

    it("Should calculate iAVAT amount for multiple stakes correctly", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await AllocationStaking.connect(alice).deposit(0, DEFAULT_DEPOSIT, 14);
      await AllocationStaking.connect(alice).deposit(0, DEFAULT_DEPOSIT, 30);
      await AllocationStaking.connect(alice).deposit(0, DEFAULT_DEPOSIT, 45);
      await AllocationStaking.connect(alice).deposit(0, DEFAULT_DEPOSIT, 60);

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(alice.address);
      const amount = takeFeeFromDeposit(DEFAULT_DEPOSIT);
      const expectediAVAT = amount
        .add(amount.mul(1500).div(1000))
        .add(amount.mul(2));
      expect(iavat).to.equal(expectediAVAT);
    });

    it("Should not be zero iAVAT during lock time", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [15 * SECONDS_IN_DAY]);
      await ethers.provider.send("evm_mine");

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(deployer.address);
      expect(iavat).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
    });

    it("Should not be zero iAVAT right after lock time", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        (DEFAULT_LOCKUP + 1) * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(deployer.address);
      expect(iavat).to.equal(takeFeeFromDeposit(DEFAULT_DEPOSIT));
    });

    it("Should be zero iAVAT for automatic relock stake", async function () {
      // Given
      await baseSetupTwoPools();

      // When
      await ethers.provider.send("evm_increaseTime", [
        (DEFAULT_LOCKUP + WITHDRAW_ALLOWED_DAYS + 1) * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      //Then
      const iavat = await AllocationStaking.getiAVATAmount(deployer.address);
      expect(iavat).to.equal(0);
    });
  });

  describe("emergencyMint", async function () {
    it("Should mint missed rewards", async function () {
      // Given
      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime + 1);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should not mint if pool was not empty", async function () {
      // Given
      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      const recipient = bob.address;
      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.updatePool(0);

      // Then
      await expect(
        AllocationStaking.emergencyMint(recipient)
      ).to.be.revertedWith("There are no missed rewards for minting");
    });

    it("Should not mint twice", async function () {
      // Given
      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      await expect(
        AllocationStaking.emergencyMint(recipient)
      ).to.be.revertedWith("There are no missed rewards for minting");
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime + 1);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint missed rewards after deposit and withdraw", async function () {
      // Given
      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_LP_APPROVAL);
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.withdraw(0, 0);

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + DEFAULT_LOCKUP * SECONDS_IN_DAY + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint correct amount if rewardPerSecond was changed", async function () {
      // Given
      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        rewardChange - skipTime,
      ]);

      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_LP_APPROVAL);

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      await ethers.provider.send("evm_setNextBlockTimestamp", [rewardChange]);
      await ethers.provider.send("evm_mine");

      // When
      const newRewardPerSecond = ethers.utils.parseUnits("0.2", DIGITS);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        rewardChange + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime).add(
        newRewardPerSecond.mul(skipTime)
      );
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint correct amount with two pools if both pools were empty", async function () {
      // Given
      await baseSetupTwoPools();
      await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + DEFAULT_LOCKUP * SECONDS_IN_DAY,
      ]);
      await ethers.provider.send("evm_mine");
      await AllocationStaking.withdraw(0, 0);
      await AllocationStaking.withdraw(1, 0);

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + DEFAULT_LOCKUP * SECONDS_IN_DAY + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
      await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint correct amount with two pools if only one pool was empty", async function () {
      // Given
      await baseSetupTwoPools();

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
      await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const totalAllocPoint = ALLOC_POINT * 2;
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime + 2)
        .mul(ALLOC_POINT)
        .div(totalAllocPoint);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint missed rewards after update call", async function () {
      // Given
      await baseSetupTwoPools();

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.massUpdatePools();

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const totalAllocPoint = ALLOC_POINT * 2;
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime + 1)
        .mul(ALLOC_POINT)
        .div(totalAllocPoint);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint missed rewards after two update calls", async function () {
      // Given
      await baseSetupTwoPools();

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.massUpdatePools();

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime * 2,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.massUpdatePools();

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const totalAllocPoint = ALLOC_POINT * 2;
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime * 2 + 1)
        .mul(ALLOC_POINT)
        .div(totalAllocPoint);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should mint correct amount if rewardPerSecond was changed with two pools", async function () {
      // Given
      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        rewardChange - skipTime + 1,
      ]);

      await ethers.provider.send("evm_setAutomine", [false]);
      await baseSetupTwoPools();
      await ethers.provider.send("evm_setAutomine", [true]);
      await ethers.provider.send("evm_mine");

      const recipient = bob.address;
      const balanceBefore = await AvatLP1.balanceOf(recipient);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        rewardChange + 1,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      const newRewardPerSecond = ethers.utils.parseUnits("0.2", DIGITS);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        rewardChange + skipTime + 1,
      ]);
      await ethers.provider.send("evm_mine");

      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);
      await AllocationStaking.deposit(1, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      await AllocationStaking.emergencyMint(recipient);

      // Then
      const balanceAfter = await AvatLP1.balanceOf(recipient);
      const totalAllocPoint = ALLOC_POINT * 2;
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime - 1)
        .add(newRewardPerSecond.mul(skipTime + 2))
        .mul(ALLOC_POINT)
        .div(totalAllocPoint);
      expect(balanceAfter).to.equal(balanceBefore.add(expectedMint));
    });

    it("Should emit an event on emergencyMint", async function () {
      // Given
      await baseSetup();
      await AvatLP1.approve(AllocationStaking.address, DEFAULT_DEPOSIT);

      const recipient = bob.address;

      const skipTime = 1500;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTimestamp + skipTime,
      ]);
      await ethers.provider.send("evm_mine");

      // When
      await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

      // Then
      const expectedMint = REWARDS_PER_SECOND.mul(skipTime + 1);
      await expect(AllocationStaking.emergencyMint(recipient))
        .to.emit(AllocationStaking, "EmergencyMint")
        .withArgs(recipient, expectedMint);
    });
  });

  context("General", async function () {
    describe("Halting", async function () {
      it("Should halt deposits and withdrawals", async function () {
        // Given
        await baseSetupTwoPools();

        expect(await AllocationStaking.contractState()).to.be.equal(0);

        // When
        await AllocationStaking.halt();

        // Then
        expect(await AllocationStaking.contractState()).to.be.equal(1);
        await expect(
          AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP)
        ).to.be.revertedWith(
          "Contract is not operating currently",
          DEFAULT_LOCKUP
        );

        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await expect(AllocationStaking.compound(1, 0)).to.be.revertedWith(
          "Contract is not operating currently"
        );
        await expect(AllocationStaking.withdraw(1, 0)).to.be.revertedWith(
          "Contract is not operating currently"
        );
      });
      it("Should resume operations", async function () {
        // Given
        await baseSetupTwoPools();
        await AllocationStaking.halt();
        expect(await AllocationStaking.contractState()).to.be.equal(1);

        // When
        await AllocationStaking.resume();

        // Then
        expect(await AllocationStaking.contractState()).to.be.equal(0);
        await AllocationStaking.deposit(1, 250, DEFAULT_LOCKUP);

        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.withdraw(1, 0);
        await AllocationStaking.compound(0, 0);
      });
    });

    describe("User's totalAmount", async function () {
      it("Should update totalAmount on deposit", async function () {
        // Given
        await baseSetupTwoPools();
        const userInfoBefore = await AllocationStaking.userInfo(
          0,
          deployer.address
        );

        // When
        await AllocationStaking.deposit(0, DEFAULT_DEPOSIT, DEFAULT_LOCKUP);

        // Then
        const userInfoAfter = await AllocationStaking.userInfo(
          0,
          deployer.address
        );
        expect(userInfoAfter.totalAmount).to.equal(
          userInfoBefore.totalAmount.add(takeFeeFromDeposit(DEFAULT_DEPOSIT))
        );
      });

      it("Should update totalAmount on withdraw", async function () {
        // Given
        await baseSetupTwoPools();
        const userInfoBefore = await AllocationStaking.userInfo(
          0,
          deployer.address
        );

        // When
        await ethers.provider.send("evm_increaseTime", [
          DEFAULT_LOCKUP * SECONDS_IN_DAY,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.withdraw(0, 0);

        // Then
        const userInfoAfter = await AllocationStaking.userInfo(
          0,
          deployer.address
        );
        expect(userInfoAfter.totalAmount).to.equal(
          userInfoBefore.totalAmount.sub(takeFeeFromDeposit(DEFAULT_DEPOSIT))
        );
      });

      it("Should update totalAmount on compound", async function () {
        // Given
        await baseSetupTwoPools();
        const userInfoBefore = await AllocationStaking.userInfo(
          0,
          deployer.address
        );

        // When
        await ethers.provider.send("evm_increaseTime", [
          START_TIMESTAMP_DELTA + 10,
        ]);
        await ethers.provider.send("evm_mine");

        await AllocationStaking.compound(0, 0);

        // Then
        const timestampNow = await getCurrentBlockTimestamp();
        const expectedReward = computeExpectedReward(
          timestampNow,
          startTimestamp,
          REWARDS_PER_SECOND,
          ALLOC_POINT,
          2 * ALLOC_POINT,
          1
        ).div(NUMBER_1E36);
        const expectedCompound = takeFeeFromDeposit(expectedReward);

        const userInfoAfter = await AllocationStaking.userInfo(
          0,
          deployer.address
        );
        expect(userInfoAfter.totalAmount).to.equal(
          userInfoBefore.totalAmount.add(expectedCompound)
        );
      });
    });
    describe("Administration", async function () {
      it("Should be able to set a new minter address by the owner", async function () {
        // Given
        await baseSetupTwoPools();

        const DistributionNew = await hre.upgrades.deployProxy(
          DistributionFactory,
          [AvatToken.address, rewardEmissions]
        );

        // When
        await AllocationStaking.setDistribution(DistributionNew.address);

        // Then
        const minterAddress = await AllocationStaking.distribution();
        expect(minterAddress).to.equal(DistributionNew.address);
      });

      it("Should not allow to call setDistribution not by an owner", async function () {
        // Given
        await baseSetupTwoPools();

        const DistributionNew = await hre.upgrades.deployProxy(
          DistributionFactory,
          [AvatToken.address, rewardEmissions]
        );

        // Then
        await expect(
          AllocationStaking.connect(alice).setDistribution(
            DistributionNew.address
          )
        ).to.be.reverted;
      });

      it("Should not allow to call setAdmin with zero address", async function () {
        // Given
        await baseSetupTwoPools();

        // Then
        await expect(
          AllocationStaking.setAdmin(ethers.constants.AddressZero)
        ).to.be.revertedWith("Cannot set zero address as admin.");
      });

      it("Should not allow to call setAdmin not by an owner", async function () {
        // Given
        await baseSetupTwoPools();
        const AdminNew = await AdminFactory.deploy([
          deployer.address,
          bob.address,
        ]);

        // Then
        await expect(
          AllocationStaking.connect(alice).setAdmin(AdminNew.address)
        ).to.be.reverted;
      });
    });
  });
});
