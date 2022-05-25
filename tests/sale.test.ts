import { expect, use } from "chai"
import { ethers, waffle } from "hardhat"
import { prepareERC20Tokens, prepareSigners } from "./utils/prepare"
import { advanceTimeAndBlock, duration, latest } from "./utils/time"
import { prepareSignatureForBuyToken, prepareSignatureForLotteryAllocation } from "./utils/prepare-signature-for-sale"

use(waffle.solidity)

// Token1 as an AVAT token
// Token2 as a selling token
// Token3 as a deposit token
// Token4 as selling marketplace token
// Alice as buyer
// Tema is a signatory
describe("Sale contract", function () {
    before(async function () {
        await prepareSigners(this)
        await prepareERC20Tokens(this, this.alice)

        const allocationStakingMockFactory = await ethers.getContractFactory("AllocationStakingMock")
        const allocationStakingMock = await allocationStakingMockFactory.deploy()

        await allocationStakingMock.deployed()
        this.allocationStakingMock = allocationStakingMock

        const farmLensV2MockFactory = await ethers.getContractFactory("FarmLensV2Mock")
        const farmLensV2Mock = await farmLensV2MockFactory.deploy()

        await farmLensV2Mock.deployed()
        this.farmLensV2Mock = farmLensV2Mock

        const salesFactoryFactory = await ethers.getContractFactory("SalesFactory")
        const salesFactory = await salesFactoryFactory.deploy(this.allocationStakingMock.address, this.tema.address, this.farmLensV2Mock.address)

        await salesFactory.deployed()
        this.salesFactory = salesFactory

        await this.salesFactory.deploySale(this.token2.address)
        const saleAddress = await this.salesFactory.lastDeployedSale()

        const sale = await ethers.getContractFactory("Sale")
        this.sale = sale.attach(saleAddress)

        const saleMarketplaceFactory = await ethers.getContractFactory("SaleMarketplace")
        const saleMarketplace = await saleMarketplaceFactory.deploy(this.salesFactory.address)

        await saleMarketplace.deployed()
        this.saleMarketplace = saleMarketplace
    })

    describe("Owner rights test", async function () {
        it("Should set the right owner on Sales Factory contract", async function () {
            expect(await this.salesFactory.owner()).to.equal(this.owner.address)
        })

        it("Should set the right owner on Sale contract", async function () {
            expect(await this.sale.owner()).to.equal(this.owner.address)
        })
    })

    describe("Sale flow", async function () {
        // Initialize sale
        before(async function (this: Mocha.Context) {
            const tokenPriceInUsd = ethers.utils.parseUnits("1", 18)
            const currentTime = await latest()

            const allocationStart = currentTime.add(duration.hours("1"))
            const allocationEnd = allocationStart.add(duration.hours("1"))

            const saleStart = allocationEnd.add(duration.hours("1"))
            const saleEnd = saleStart.add(duration.hours("1"))

            const fcfsStart = saleEnd.add(duration.hours("1"))
            const fcfsEnd = fcfsStart.add(duration.hours("1"))

            const distributionPeriods = [
                { percent: ethers.utils.parseUnits("40", 2), timestamp: fcfsEnd.add(duration.hours("1")) },
                { percent: ethers.utils.parseUnits("60", 2), timestamp: fcfsEnd.add(duration.hours("2")) },
            ]

            this.distributionPeriods = distributionPeriods
            this.allocationStart = allocationStart
            this.allocationEnd = allocationEnd
            this.saleStart = saleStart
            this.saleEnd = saleEnd
            this.fcfsStart = fcfsStart
            this.fcfsEnd = fcfsEnd

            await this.sale.initialize(
                [this.token3.address],
                tokenPriceInUsd,
                {
                    startTime: allocationStart,
                    endTime: allocationEnd,
                },
                {
                    startTime: saleStart,
                    endTime: saleEnd,
                },
                {
                    startTime: fcfsStart,
                    endTime: fcfsEnd,
                },
                {
                    startTime: allocationStart,
                    endTime: allocationEnd,
                },
                distributionPeriods
            )
        })

        describe("Initialization config", async function () {
            it("Should be initialized", async function () {
                expect(await this.sale.isInitialized()).to.equal(true)
            })

            it("Should transfer selling tokens", async function () {
                const sellingAmount = await this.token2.balanceOf(this.alice.address)
                await this.token2.connect(this.alice).transfer(this.sale.address, sellingAmount)

                expect(await this.token2.balanceOf(this.sale.address)).to.equal(sellingAmount)
            })

            it("Should update sale distribution periods", async function () {
                const distributionPeriods = [
                    { percent: ethers.utils.parseUnits("50", 2), timestamp: this.fcfsEnd.add(duration.hours("1")) },
                    { percent: ethers.utils.parseUnits("50", 2), timestamp: this.fcfsEnd.add(duration.hours("2")) },
                ]

                await this.sale.updateDistributionPeriods(distributionPeriods)
                const distributionPeriods_ = await this.sale.getDistributionPeriods()

                expect(distributionPeriods).to.eql(distributionPeriods_.map(({ timestamp, percent }) => ({ timestamp, percent })))
            })

            it("Should update allocations dates", async function () {
                const allocationStart = this.allocationStart.add(duration.minutes("30"))
                const allocationEnd = this.allocationEnd.add(duration.minutes("30"))
                this.allocationStart = allocationStart
                this.allocationEnd = allocationEnd

                await this.sale.updateAllocationPeriod(allocationStart, allocationEnd)

                expect(allocationStart).to.equal((await this.sale.allocation()).startTime)
                expect(allocationEnd).to.equal((await this.sale.allocation()).endTime)
            })

            it("Should update sale dates", async function () {
                const saleStart = this.saleStart.add(duration.minutes("30"))
                const saleEnd = this.saleEnd.add(duration.minutes("30"))
                this.saleStart = saleStart
                this.saleEnd = saleEnd

                await this.sale.updateSalePeriod(saleStart, saleEnd)

                expect(saleStart).to.equal((await this.sale.sale()).startTime)
                expect(saleEnd).to.equal((await this.sale.sale()).endTime)
            })

            it("Should update FCFS dates", async function () {
                const fcfsStart = this.fcfsStart.add(duration.minutes("30"))
                const fcfsEnd = this.fcfsEnd.add(duration.minutes("30"))
                this.fcfsStart = fcfsStart
                this.fcfsEnd = fcfsEnd

                await this.sale.updateFCFSPeriod(fcfsStart, fcfsEnd)

                expect(fcfsStart).to.equal((await this.sale.fcfs()).startTime)
                expect(fcfsEnd).to.equal((await this.sale.fcfs()).endTime)
            })

            it("Should update sale token price", async function () {
                const tokenPriceInUSD = ethers.utils.parseUnits("2", 18)

                await this.sale.updateTokenRates(tokenPriceInUSD)

                expect(tokenPriceInUSD).to.equal(await this.sale.tokenPriceInUSD())
            })
        })

        describe("Allocation", async function () {
            it("Should receive staking allocation", async function () {
                await advanceTimeAndBlock((await this.sale.allocation()).startTime.sub(await latest()))
                const expectedTakenAllocation = ethers.utils.parseUnits("1000", 6)
                this.stakingTakenAllocation = expectedTakenAllocation

                expect(() => this.sale.connect(this.alice).takeStakingAllocation(this.alice.address)).to.changeTokenBalance(
                    this.sale.address,
                    this.alice.address,
                    expectedTakenAllocation
                )
            })

            it("Should not take staking allocation again", async function () {
                await this.sale.connect(this.alice).takeStakingAllocation(this.alice.address)

                await expect(this.sale.connect(this.alice).takeStakingAllocation(this.alice.address)).to.be.revertedWith("TSA4")
            })

            it("Should receive lottery allocation", async function () {
                const expectedTakenAllocation = ethers.utils.parseUnits("200", 6)

                const { tokenAmount, deadline, v, r, s } = await prepareSignatureForLotteryAllocation(
                    this.alice.address,
                    expectedTakenAllocation.toNumber(),
                    this.tema.address,
                    this.sale.address
                )

                expect(() =>
                    this.sale.connect(this.alice).takeLotteryAllocation(this.alice.address, tokenAmount, deadline, v, r, s)
                ).to.changeTokenBalance(this.sale.address, this.alice.address, expectedTakenAllocation)
            })

            it("Should not take lottery allocation", async function () {
                const expectedTakenAllocation = ethers.utils.parseUnits("200", 6)

                const { tokenAmount, deadline, v, r, s } = await prepareSignatureForLotteryAllocation(
                    this.alice.address,
                    expectedTakenAllocation.toNumber(),
                    this.bob.address,
                    this.sale.address
                )

                await expect(
                    this.sale.connect(this.alice).takeLotteryAllocation(this.alice.address, tokenAmount, deadline, v, r, s)
                ).to.be.revertedWith("TLA1")

                expect(this.stakingTakenAllocation).to.equal(await this.sale.balanceOf(this.alice.address))
            })
        })

        describe("Marketplace", async function () {
            it("Should deposit tokens (Alice)", async function () {
                const iAvatamount = ethers.utils.parseUnits("10", "6")
                const tradePrice = ethers.utils.parseUnits("20", "6")

                this.tradePrice = tradePrice
                this.iAvatamount = iAvatamount

                await this.sale.connect(this.alice).approve(this.saleMarketplace.address, iAvatamount)
                await this.saleMarketplace.connect(this.alice).deposit(this.sale.address, iAvatamount)
                expect(await this.sale.balanceOf(this.saleMarketplace.address)).to.equal(iAvatamount)
            })

            it("Should deposit tokens (Carol)", async function () {
                await this.token4.connect(this.alice).transfer(this.carol.address, this.tradePrice)
                await this.token4.connect(this.carol).approve(this.saleMarketplace.address, this.tradePrice)
                await this.saleMarketplace.connect(this.carol).deposit(this.token4.address, this.tradePrice)
                expect(await this.token4.balanceOf(this.saleMarketplace.address)).to.equal(this.tradePrice)
            })

            it("Should create order", async function () {
                const tx = await this.saleMarketplace
                    .connect(this.alice)
                    .create(this.sale.address, this.iAvatamount, this.token4.address, this.tradePrice)

                // @ts-ignore (Subgraph implementation)
                const tradeId = (await tx.wait()).events?.pop()?.args["id"]
                this.tradeId = tradeId

                expect(await this.saleMarketplace.trades(tradeId)).to.eql([
                    this.alice.address,
                    this.sale.address,
                    this.iAvatamount,
                    this.token4.address,
                    this.tradePrice,
                    "0x0000000000000000000000000000000000000000",
                    false,
                ])
            })

            it("Should buy order", async function () {
                await this.saleMarketplace.connect(this.carol).buy(this.tradeId)

                expect(await this.saleMarketplace.trades(this.tradeId)).to.eql([
                    this.alice.address,
                    this.sale.address,
                    this.iAvatamount,
                    this.token4.address,
                    this.tradePrice,
                    this.carol.address,
                    true,
                ])
            })

            it("Should withdraw iAVAT (Carol)", async function () {
                await this.saleMarketplace.connect(this.carol).withdraw(this.sale.address, this.iAvatamount)

                expect(await this.sale.balanceOf(this.carol.address)).to.equal(this.iAvatamount)
            })

            it("Should withdraw selling token (Alice)", async function () {
                const previousBalance = await this.token4.balanceOf(this.alice.address)
                await this.saleMarketplace.connect(this.alice).withdraw(this.token4.address, this.tradePrice)

                expect(await this.token4.balanceOf(this.alice.address)).to.equal(previousBalance.add(this.tradePrice))
            })
        })

        describe("Sale", async function () {
            it("Should not buy tokens because sale has not started yet", async function () {
                const { deadline, v, r, s } = await prepareSignatureForBuyToken(this.alice.address, this.tema.address, this.sale.address)

                await expect(
                    this.sale
                        .connect(this.alice)
                        .buyToken(this.token3.address, await this.token3.balanceOf(this.alice.address), deadline, v, r, s)
                ).to.be.revertedWith("BT1")
            })

            it("Should buy tokens", async function () {
                const amountToBuy = ethers.utils.parseUnits("90000", 6)

                await advanceTimeAndBlock((await this.sale.sale()).startTime.sub(await latest()))

                const { deadline, v, r, s } = await prepareSignatureForBuyToken(this.alice.address, this.tema.address, this.sale.address)

                await this.token3.connect(this.alice).approve(this.sale.address, await this.token3.balanceOf(this.alice.address))
                await this.sale.connect(this.alice).buyToken(this.token3.address, amountToBuy, deadline, v, r, s)

                expect(await this.sale.totalTokensBuy()).to.be.equal(amountToBuy.div("2"))
                expect(await this.token3.balanceOf(this.sale.address)).to.be.equal(amountToBuy)
            })
        })

        describe("FCFS", async function () {
            it("Should not buy tokens because FCFS has not started yet", async function () {
                const { deadline, v, r, s } = await prepareSignatureForBuyToken(this.alice.address, this.tema.address, this.sale.address)

                await expect(
                    this.sale
                        .connect(this.alice)
                        .buyTokenOnFCFS(this.token3.address, await this.token3.balanceOf(this.alice.address), deadline, v, r, s)
                ).to.be.revertedWith("BTOF1")
            })

            it("Should buy tokens", async function () {
                const amountToBuy = ethers.utils.parseUnits("10000", 6)

                await advanceTimeAndBlock((await this.sale.fcfs()).startTime.sub(await latest()))
                const { deadline, v, r, s } = await prepareSignatureForBuyToken(this.bob.address, this.tema.address, this.sale.address)

                await this.token3.connect(this.alice).transfer(this.bob.address, amountToBuy)
                await this.token3.connect(this.bob).approve(this.sale.address, amountToBuy)

                await this.sale.connect(this.bob).buyTokenOnFCFS(this.token3.address, amountToBuy, deadline, v, r, s)

                expect(await this.sale.totalTokensBuy()).to.be.equal(ethers.utils.parseUnits("50000", 6))
                expect(await this.token3.balanceOf(this.sale.address)).to.be.equal(ethers.utils.parseUnits("100000", 6))
            })
        })

        describe("Claim", async function () {
            it("Should not buy tokens because claim has not started yet", async function () {
                await expect(this.sale.connect(this.alice).claimToken(0)).to.be.revertedWith("CT1")
            })

            it("Should claim the first period", async function () {
                await advanceTimeAndBlock((await this.sale.getDistributionPeriods())[0].timestamp.sub(await latest()))

                await this.sale.connect(this.alice).claimToken(0)

                expect(await this.token2.balanceOf(this.alice.address)).to.be.equal(ethers.utils.parseUnits("22500", 6))
            })

            it("Should claim the second period", async function () {
                await advanceTimeAndBlock((await this.sale.getDistributionPeriods())[1].timestamp.sub(await latest()))

                await this.sale.connect(this.alice).claimToken(1)

                expect(await this.token2.balanceOf(this.alice.address)).to.be.equal(ethers.utils.parseUnits("45000", 6))
            })
        })

        describe("Collect tokens", async function () {
            it("Should collect raised tokens", async function () {
                const amountToCollect = ethers.utils.parseUnits("100000", 6)

                await this.sale.collectRaisedTokens(this.token3.address, this.tema.address, amountToCollect)

                expect(await this.token3.balanceOf(this.tema.address)).to.equal(amountToCollect)
                expect(await this.token3.balanceOf(this.sale.address)).to.equal("0")
            })

            it("Should collect leftover tokens", async function () {
                const amountToCollect = ethers.utils.parseUnits("50000", 6)
                await this.sale.collectLeftoverTokens(amountToCollect, this.tema.address)

                expect(await this.token2.balanceOf(this.tema.address)).to.equal(amountToCollect)
                expect(await this.token2.balanceOf(this.sale.address)).to.equal(ethers.utils.parseUnits("5000", 6))
            })
        })
    })
})
