import { readFileSync } from "fs"
import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments
    const { BigNumber } = ethers

    const { deployer } = await getNamedAccounts()

    if ((await hre.getChainId()) == "43114") {
        const distributionV2 = "0x54f59bdDc5bcE2b1e1dec6cE547F35ABdb7755e1"

        deployments.save("DistributionV2", {
            address: distributionV2,
            abi: JSON.parse(readFileSync(`${__dirname}/../build/abis/DistributionV2.json`, "utf8")),
        })

        console.log(`reusing "DistributionV2" at ${distributionV2}`)
        return
    }

    const avatTokenAddress = (await deployments.get("AvatToken")).address

    const distributionV2 = await deploy("DistributionV2", {
        from: deployer,
        proxy: {
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [
                        avatTokenAddress,
                        [
                            [1648746000, 1649955600, BigNumber.from("2100000000000000000")],
                            [1649955601, 1651338000, BigNumber.from("700000000000000000")],
                            [1651338001, 1654016400, BigNumber.from("665000000000000000")],
                            [1654016401, 1656608400, BigNumber.from("631750000000000000")],
                            [1656608401, 1659286800, BigNumber.from("600162500000000000")],
                            [1659286801, 1661965200, BigNumber.from("570154375000000000")],
                            [1661965201, 1664557200, BigNumber.from("541646656250000000")],
                            [1664557201, 1667235600, BigNumber.from("514564323438000000")],
                            [1667235601, 1669827600, BigNumber.from("488836107266000000")],
                            [1669827601, 1672506000, BigNumber.from("464394301902000000")],
                            [1672506001, 1675184400, BigNumber.from("441174586807000000")],
                            [1675184401, 1677603600, BigNumber.from("430145222137000000")],
                            [1677603601, 1680282000, BigNumber.from("419391591584000000")],
                            [1680282001, 1682874000, BigNumber.from("408906801794000000")],
                            [1682874001, 1685552400, BigNumber.from("398684131749000000")],
                            [1685552401, 1688144400, BigNumber.from("388717028455000000")],
                            [1688144401, 1690822800, BigNumber.from("378999102744000000")],
                            [1690822801, 1693501200, BigNumber.from("369524125175000000")],
                            [1693501201, 1696093200, BigNumber.from("360286022046000000")],
                            [1696093201, 1698771600, BigNumber.from("351278871495000000")],
                            [1698771601, 1701363600, BigNumber.from("342496899708000000")],
                            [1701363601, 1704042000, BigNumber.from("333934477215000000")],
                            [1704042001, 1706720400, BigNumber.from("325586115284000000")],
                            [1706720401, 1709226000, BigNumber.from("319074392979000000")],
                            [1709226001, 1711904400, BigNumber.from("312692905119000000")],
                            [1711904401, 1714496400, BigNumber.from("306439047017000000")],
                            [1714496401, 1717174800, BigNumber.from("300310266077000000")],
                            [1717174801, 1719766800, BigNumber.from("294304060755000000")],
                            [1719766801, 1722445200, BigNumber.from("288417979540000000")],
                            [1722445201, 1725123600, BigNumber.from("282649619949000000")],
                            [1725123601, 1727715600, BigNumber.from("276996627550000000")],
                            [1727715601, 1730394000, BigNumber.from("271456694999000000")],
                            [1730394001, 1732986000, BigNumber.from("266027561099000000")],
                            [1732986001, 1735664400, BigNumber.from("260707009877000000")],
                            [1735664401, 1738342800, BigNumber.from("255492869680000000")],
                            [1738342801, 1740762000, BigNumber.from("252937940983000000")],
                            [1740762001, 1743440400, BigNumber.from("250408561573000000")],
                        ],
                    ],
                },
            },
        },
        log: true,
    })

    if (distributionV2.newlyDeployed) {
        const avatToken = (await ethers.getContractFactory("AvatToken")).attach(avatTokenAddress)
        const transferOwnershipTx = await (await avatToken.transferOwnership(distributionV2.address)).wait()

        console.log(`distribution transfered (tx: ${transferOwnershipTx.transactionHash})`)
    }
}

module.exports.tags = ["DistributionV2"]
module.exports.dependencies = ["AvatToken"]
