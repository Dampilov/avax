import { Contract } from "@ethersproject/contracts"
import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, ContractFactory } from "ethers"
import { AvatToken, AvatToken__factory, DistributionV2, DistributionV2__factory } from "../build/typechain"

describe("Distribution", function () {
    let AvatToken: AvatToken__factory
    let Distribution: DistributionV2__factory
    let avatTokenContract: AvatToken
    let distributionContract: DistributionV2
    let owner: SignerWithAddress

    let address1: SignerWithAddress
    let address2: SignerWithAddress

    let addrs: SignerWithAddress[]
    let currentTime: number
    let rewardEmissions: any[][]

    const avatName = "AVAT"
    const avatSymbol = "AVAT"
    const avatTotalCap = ethers.utils.parseEther("100000000")
    const avatInitialMint = 60000000000000
    let REWARD_PRECISION: number

    async function getCurrentBlockTimestamp() {
        return (await ethers.provider.getBlock("latest")).timestamp
    }

    before(async function () {
        AvatToken = await ethers.getContractFactory("AvatToken")
        ;[owner, address1, address2, ...addrs] = await ethers.getSigners()

        avatTokenContract = await AvatToken.deploy(avatName, avatSymbol, avatInitialMint, avatTotalCap)

        Distribution = await ethers.getContractFactory("DistributionV2")
        currentTime = await getCurrentBlockTimestamp()

        rewardEmissions = [
            [1648746000, 1649955600, BigNumber.from((2100000000000 * 1e6).toString())],
            [1649955601, 1651338000, BigNumber.from((700000000000 * 1e6).toString())],
            [1651338001, 1654016400, BigNumber.from((665000000000 * 1e6).toString())],
            [1654016401, 1656608400, BigNumber.from((631750000000 * 1e6).toString())],
            [1656608401, 1659286800, BigNumber.from((600162500000 * 1e6).toString())],
            [1659286801, 1661965200, BigNumber.from((570154375000 * 1e6).toString())],
            [1661965201, 1664557200, BigNumber.from((541646656250 * 1e6).toString())],
            [1664557201, 1667235600, BigNumber.from((514564323438 * 1e6).toString())],
            [1667235601, 1669827600, BigNumber.from((488836107266 * 1e6).toString())],
            [1669827601, 1672506000, BigNumber.from((464394301902 * 1e6).toString())],
            [1672506001, 1675184400, BigNumber.from((441174586807 * 1e6).toString())],
            [1675184401, 1677603600, BigNumber.from((430145222137 * 1e6).toString())],
            [1677603601, 1680282000, BigNumber.from((419391591584 * 1e6).toString())],
            [1680282001, 1682874000, BigNumber.from((408906801794 * 1e6).toString())],
            [1682874001, 1685552400, BigNumber.from((398684131749 * 1e6).toString())],
            [1685552401, 1688144400, BigNumber.from((388717028455 * 1e6).toString())],
            [1688144401, 1690822800, BigNumber.from((378999102744 * 1e6).toString())],
            [1690822801, 1693501200, BigNumber.from((369524125175 * 1e6).toString())],
            [1693501201, 1696093200, BigNumber.from((360286022046 * 1e6).toString())],
            [1696093201, 1698771600, BigNumber.from((351278871495 * 1e6).toString())],
            [1698771601, 1701363600, BigNumber.from((342496899708 * 1e6).toString())],
            [1701363601, 1704042000, BigNumber.from((333934477215 * 1e6).toString())],
            [1704042001, 1706720400, BigNumber.from((325586115284 * 1e6).toString())],
            [1706720401, 1709226000, BigNumber.from((319074392979 * 1e6).toString())],
            [1709226001, 1711904400, BigNumber.from((312692905119 * 1e6).toString())],
            [1711904401, 1714496400, BigNumber.from((306439047017 * 1e6).toString())],
            [1714496401, 1717174800, BigNumber.from((300310266077 * 1e6).toString())],
            [1717174801, 1719766800, BigNumber.from((294304060755 * 1e6).toString())],
            [1719766801, 1722445200, BigNumber.from((288417979540 * 1e6).toString())],
            [1722445201, 1725123600, BigNumber.from((282649619949 * 1e6).toString())],
            [1725123601, 1727715600, BigNumber.from((276996627550 * 1e6).toString())],
            [1727715601, 1730394000, BigNumber.from((271456694999 * 1e6).toString())],
            [1730394001, 1732986000, BigNumber.from((266027561099 * 1e6).toString())],
            [1732986001, 1735664400, BigNumber.from((260707009877 * 1e6).toString())],
            [1735664401, 1738342800, BigNumber.from((255492869680 * 1e6).toString())],
            [1738342801, 1740762000, BigNumber.from((252937940983 * 1e6).toString())],
            [1740762001, 1743440400, BigNumber.from((250408561573 * 1e6).toString())],
        ]

        distributionContract = (await upgrades.deployProxy(Distribution as ContractFactory, [
            avatTokenContract.address,
            rewardEmissions,
        ])) as DistributionV2

        await distributionContract.deployed()
        console.log(" DistributionV2 address: ", distributionContract.address)
        console.log(" Avat address: ", avatTokenContract.address)
        await avatTokenContract.transferOwnership(distributionContract.address)

        REWARD_PRECISION = +(await distributionContract.REWARD_PRECISION())
    })

    describe("Distribution main test", async function () {
        it("Should set the right avat owner", async function () {
            expect(await avatTokenContract.owner()).to.equal(distributionContract.address)
        })

        it("Should set the right Distribution admin == owner", async function () {
            expect(await distributionContract.getAllAdmins()).to.eql([owner.address])
        })

        it("Should mint token for address1", async function () {
            const mintTokens = await distributionContract.connect(owner).mintTokens(address1.address, 100000)
            await mintTokens.wait()
            const balanceOf = await avatTokenContract.balanceOf(address1.address)
            expect(balanceOf).to.equal(100000)
        })

        it("Should block mint for address 2 (not admin)", async function () {
            await expect(distributionContract.connect(address2).mintTokens(address1.address, 100000)).to.be.revertedWith("Only admin can call.")
        })

        it("Should mint token for address2 (admin)", async function () {
            const addAdmin = await distributionContract.connect(owner).addAdmin(address2.address)
            await addAdmin.wait()

            const mintTokens = await distributionContract.connect(address2).mintTokens(address1.address, 100000)
            await mintTokens.wait()

            const balanceOf = await avatTokenContract.balanceOf(address1.address)
            expect(balanceOf).to.equal(200000)
        })

        it("Should set the right Distribution admin == [owner, address2]", async function () {
            expect(await distributionContract.getAllAdmins()).to.eql([owner.address, address2.address])
        })
    })
    describe("Distribution pool test", async function () {
        it("Should set the pool address and allocation point only owner", async function () {
            const setPool = await distributionContract.connect(owner).setPool(address1.address, 50)
            setPool.wait()
            const poolAllocation = await distributionContract.pools(address1.address)
            expect(poolAllocation).to.equal(50)
        })

        it("Should used 100 percent of allocation point", async function () {
            const setPool = await distributionContract.connect(owner).setPool(address1.address, 100)
            setPool.wait()
            expect(await distributionContract.allocationPointUsed()).to.equal(100)
        })

        it("Should not set a pool with a larger allocation", async function () {
            expect(distributionContract.connect(owner).setPool(address2.address, 100)).to.be.revertedWith(
                "DistributionV2::setPool: allowed allocation exceeded"
            )
        })
    })

    describe("Distribution rewards amount counting test", async function () {
        it("Should check -s--e-|------|------|------|------>", async function () {
            const start = rewardEmissions[0][0] - 20
            const end = rewardEmissions[0][0] - 10

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            expect(rewardAmount).to.equal(0)
        })

        it("Should check ------|------|------|------|-s--e->", async function () {
            const length = rewardEmissions.length

            const start = rewardEmissions[length - 1][1] + 10
            const end = start + 20

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            expect(rewardAmount).to.equal(0)
        })

        it("Should check ---s--|------|---e--|------|------>", async function () {
            const start = rewardEmissions[0][0] - 20
            const end = rewardEmissions[1][0] + 20

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            const result =
                ((rewardEmissions[0][1] - rewardEmissions[0][0]) * rewardEmissions[0][2]) / REWARD_PRECISION +
                ((end - rewardEmissions[1][0]) * rewardEmissions[1][2]) / REWARD_PRECISION

            expect(rewardAmount).to.equal(result)
        })

        it("Should check ------|---s--|---e--|------|------>", async function () {
            const start = rewardEmissions[1][0] + 20
            const end = rewardEmissions[2][0] + 20

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            const result =
                ((rewardEmissions[1][1] - start) * rewardEmissions[1][2]) / REWARD_PRECISION +
                ((end - rewardEmissions[2][0]) * rewardEmissions[2][2]) / REWARD_PRECISION

            expect(rewardAmount).to.equal(result)
        })

        it("Should check ------|-s--e-|------|------|------>", async function () {
            const start = rewardEmissions[3][0] + 20
            const end = start + 100

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            const result = ((end - start) * rewardEmissions[3][2]) / REWARD_PRECISION

            expect(rewardAmount).to.equal(result)
        })

        it("Should check ------|---s--|------|---e--|------>", async function () {
            const start = rewardEmissions[3][0] + 20
            const end = rewardEmissions[5][0] + 20

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            const result =
                ((rewardEmissions[3][1] - start) * rewardEmissions[3][2]) / REWARD_PRECISION +
                ((rewardEmissions[4][1] - rewardEmissions[4][0]) * rewardEmissions[4][2]) / REWARD_PRECISION +
                ((end - rewardEmissions[5][0]) * rewardEmissions[5][2]) / REWARD_PRECISION

            expect(rewardAmount).to.equal(BigNumber.from(result.toString()))
        })

        it("Should check ------|---s--|------|------|---e-->", async function () {
            const length = rewardEmissions.length

            const start = rewardEmissions[length - 2][0] + 20
            const end = rewardEmissions[length - 1][1] + 10000

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            const result =
                ((rewardEmissions[length - 2][1] - start) * rewardEmissions[length - 2][2]) / REWARD_PRECISION +
                ((rewardEmissions[length - 1][1] - rewardEmissions[length - 1][0]) * rewardEmissions[length - 1][2]) / REWARD_PRECISION

            expect(rewardAmount).to.equal(BigNumber.from(result.toString()))
        })

        it("Should count full reward emission ", async function () {
            const length = rewardEmissions.length

            const start = rewardEmissions[0][0]
            const end = rewardEmissions[length - 1][1]

            const rewardAmount = await distributionContract.connect(address1).countRewardAmount(start, end)

            let result = 0

            for (const re of rewardEmissions) {
                const [reStart, reEnd, reRPS] = re
                result = result + ((reEnd - reStart) * reRPS) / REWARD_PRECISION
            }

            expect(rewardAmount).to.equal(BigNumber.from(result.toString()))
        })
    })
})
