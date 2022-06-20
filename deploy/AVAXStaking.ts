import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const wavaxAddress = (await deployments.get("WAVAX")).address
    const depositToken = (await deployments.get("AvatToken")).address
    const depositFeePrecision = 10000
    const depositFeePercent = 50 // 0.5%
    const tokenBlockTime = 600 // default: 604800

    await deploy("AVAXStaking", {
        from: deployer,
        proxy: {
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [wavaxAddress, depositToken, depositFeePrecision, depositFeePercent, tokenBlockTime],
                },
            },
        },
        log: true,
    })
}

module.exports.tags = ["AVAXStaking"]
module.exports.dependencies = ["WAVAX", "AvatToken"]
