import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const wavaxAddress = (await deployments.get("WAVAX")).address
    const depositFeePrecision = 10000

    const avaxStaking = await deploy("AVAXStaking", {
        from: deployer,
        proxy: {
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [
                        wavaxAddress,
                        depositFeePrecision,
                    ],
                },
            },
        },
        log: true,
    })

    if (avaxStaking.newlyDeployed) {
        const staking = (await ethers.getContractFactory("AVAXStaking")).attach(avaxStaking.address)

        // IERC20Upgradeable _depositToken,
        const depositToken = (await deployments.get("AvatToken")).address
        // uint256 _allocPoint,
        const allocPoint = ethers.utils.parseUnits('10', 12)
        // uint256 _depositFeePercent,
        const depositFeePercent = 50 // 0.5% 
        // uint256 tokenBlockTime,
        const tokenBlockTime = 600 // default: 604800
        // bool _withUpdate
        const withUpdate = false

        const addPoolTx = await (await staking.add(depositToken, allocPoint, depositFeePercent, tokenBlockTime, withUpdate)).wait()
        console.log(`add AVAT staking to AVAX staking (tx: ${addPoolTx.transactionHash})`)
    }

}

module.exports.tags = ["AVAXStaking"]
module.exports.dependencies = ["WAVAX", "AvatToken"]
