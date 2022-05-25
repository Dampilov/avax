import { expect, use } from "chai"
import { BigNumber, ContractFactory } from "ethers"
import { ethers, upgrades, waffle } from "hardhat"
import { DistributionV2 } from "../build/typechain"
import { prepareERC20Tokens, prepareSigners } from "./utils/prepare"
import { advanceTimeAndBlock, duration } from "./utils/time"

use(waffle.solidity)

// Alice owner of all tokens
// Token2 for bonus1 token
// Token3 for bonus2 token
// Token4 for LP1 token
// Token5 for LP2 token
describe("Farming contract", function () {
    before(async function () {
        await prepareSigners(this)
        await prepareERC20Tokens(this, this.alice)

        const avatTokenFactory = await ethers.getContractFactory("AvatToken")

        const avatToken = await avatTokenFactory.deploy(
            "AVAT",
            "AVAT",
            ethers.utils.parseUnits("1000000", 6),
            ethers.utils.parseUnits("100000000", 6)
        )

        await avatToken.deployed()
        this.avatToken = avatToken

        const distributionV2Factory = await ethers.getContractFactory("DistributionV2")

        const distributionV2 = (await upgrades.deployProxy(distributionV2Factory as ContractFactory, [
            this.avatToken.address,
            [
                [1, 19999999999, BigNumber.from("100000000000000000")],
                [20000000000, 20000000001, BigNumber.from("100000000000000000")],
            ],
        ])) as DistributionV2

        await distributionV2.deployed()
        this.distributionV2 = distributionV2

        await (await this.avatToken.transferOwnership(distributionV2.address)).wait()

        const farmingFactoryFactory = await ethers.getContractFactory("FarmingFactory")

        const farmingFactory = await farmingFactoryFactory.deploy(this.token1.address, this.distributionV2.address)

        await farmingFactory.deployed()
        this.farmingFactory = farmingFactory

        await (await this.distributionV2.addAdmin(this.farmingFactory.address)).wait()
        await (await this.distributionV2.setPool(this.farmingFactory.address, 100)).wait()
    })

    describe("Farming flow test", async function () {
        before(async function () {
            await this.token4.connect(this.alice).transfer(this.bob.address, ethers.utils.parseUnits("10000", await this.token4.decimals()))
            await this.token5.connect(this.alice).transfer(this.bob.address, ethers.utils.parseUnits("10000", await this.token4.decimals()))

            await this.token4.connect(this.alice).transfer(this.carol.address, ethers.utils.parseUnits("10000", await this.token4.decimals()))
            await this.token5.connect(this.alice).transfer(this.carol.address, ethers.utils.parseUnits("10000", await this.token4.decimals()))
        })

        it("Should deploy farming #1 with AVAT + Bonus tokens rewards", async function () {
            const lpToken = this.token4

            const bonusToken = this.token2
            const bonusTokenPerSec = ethers.utils.parseUnits("1", await bonusToken.decimals())
            const farming1AllocationPoint = BigNumber.from("60").mul(await this.farmingFactory.AP_PRECISION())
            const farming1StartTimestamp = 0
            const avatReward = true

            const farming1Tx = await this.farmingFactory.deployFarming(
                lpToken.address,
                bonusToken.address,
                bonusTokenPerSec,
                avatReward,
                farming1StartTimestamp,
                farming1AllocationPoint
            )

            const txReceipt = await farming1Tx.wait()

            // @ts-ignore
            const deployedFarmingAddress = txReceipt.events?.pop()?.args["farmingAddress"]
            expect(await this.farmingFactory.lastDeployedFarming()).to.equal(deployedFarmingAddress)

            this.farming1 = (await ethers.getContractFactory("Farming")).attach(deployedFarmingAddress)
            await bonusToken.connect(this.alice).transfer(this.farming1.address, ethers.utils.parseUnits("100000", await bonusToken.decimals()))
        })

        it("Should deploy farming #2 with AVAT token rewards only", async function () {
            const lpToken = this.token5

            const bonusTokenAddress = "0x0000000000000000000000000000000000000000"
            const bonusTokenPerSec = 0
            const farming2AllocationPoint = BigNumber.from("40").mul(await this.farmingFactory.AP_PRECISION())
            const farming2StartTimestamp = 0
            const avatReward = true

            const farming2Tx = await this.farmingFactory.deployFarming(
                lpToken.address,
                bonusTokenAddress,
                bonusTokenPerSec,
                avatReward,
                farming2StartTimestamp,
                farming2AllocationPoint
            )

            const txReceipt = await farming2Tx.wait()

            // @ts-ignore
            const deployedFarmingAddress = txReceipt.events?.pop()?.args["farmingAddress"]
            expect(await this.farmingFactory.lastDeployedFarming()).to.equal(deployedFarmingAddress)

            this.farming2 = (await ethers.getContractFactory("Farming")).attach(deployedFarmingAddress)
        })

        it("Should deploy farming #3 with Bonus token rewards only", async function () {
            const lpToken = this.token4

            const bonusToken = this.token3
            const bonusTokenPerSec = ethers.utils.parseUnits("1", await bonusToken.decimals())
            const farming3AllocationPoint = BigNumber.from("60").mul(await this.farmingFactory.AP_PRECISION())
            const farming3StartTimestamp = 0
            const avatReward = false

            const farming3Tx = await this.farmingFactory.deployFarming(
                lpToken.address,
                bonusToken.address,
                bonusTokenPerSec,
                avatReward,
                farming3AllocationPoint,
                farming3StartTimestamp
            )

            const txReceipt = await farming3Tx.wait()

            // @ts-ignore
            const deployedFarmingAddress = txReceipt.events?.pop()?.args["farmingAddress"]
            expect(await this.farmingFactory.lastDeployedFarming()).to.equal(deployedFarmingAddress)

            this.farming3 = (await ethers.getContractFactory("Farming")).attach(deployedFarmingAddress)
            await bonusToken.connect(this.alice).transfer(this.farming3.address, ethers.utils.parseUnits("100000", await bonusToken.decimals()))
        })

        it("Alice should deposit LP tokens in Farming #1", async function () {
            const amount = ethers.utils.parseUnits("100", await this.token4.decimals())

            await this.token4.connect(this.alice).approve(this.farming1.address, amount)
            await this.farming1.connect(this.alice).deposit(amount)

            expect((await this.farming1.userInfo(this.alice.address)).amount).to.equal(amount)
        })

        it("Bob should deposit LP tokens in Farming #1", async function () {
            const amount = ethers.utils.parseUnits("50", await this.token4.decimals())

            await this.token4.connect(this.bob).approve(this.farming1.address, amount)
            await this.farming1.connect(this.bob).deposit(amount)

            expect((await this.farming1.userInfo(this.bob.address)).amount).to.equal(amount)
        })

        it("Carol should deposit LP tokens in Farming #1", async function () {
            const amount = ethers.utils.parseUnits("200", await this.token4.decimals())

            await this.token4.connect(this.carol).approve(this.farming1.address, amount)
            await this.farming1.connect(this.carol).deposit(amount)

            expect((await this.farming1.userInfo(this.carol.address)).amount).to.equal(amount)
        })

        it("Advance time in EVM", async function () {
            await advanceTimeAndBlock(duration.hours("1"))
        })

        it("Alice should harvest AVAT + Bonus tokens in Farming #1", async function () {
            const pending = await this.farming1.pending(this.alice.address)
            console.log(pending)
            await this.farming1.connect(this.alice).deposit(0)
        })

        it("Alice should withdraw LP tokens in Farming #1", async function () {
            const pending = await this.farming1.pending(this.alice.address)
            console.log(pending)

            const amountToWithdraw = (await this.farming1.userInfo(this.alice.address)).amount
            await this.farming1.connect(this.alice).withdraw(amountToWithdraw)
        })
    })
})
