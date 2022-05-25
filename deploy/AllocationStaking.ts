import { readFileSync } from "fs"
import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    if ((await hre.getChainId()) == "43114") {
        const allocationStaking = "0xA8cD6789Dabde5019b199093c15f7447e3C05578"

        deployments.save("AllocationStaking", {
            address: allocationStaking,
            abi: JSON.parse(readFileSync(`${__dirname}/../build/abis/AllocationStaking.json`, "utf8")),
        })

        console.log(`reusing "AllocationStaking" at ${allocationStaking}`)
        return
    }

    const avatTokenAddress = (await deployments.get("AvatToken")).address
    const distributionV2Address = (await deployments.get("DistributionV2")).address
    const DEPOSIT_FEE_PERCENT = 2
    const DEPOSIT_FEE_PRECISION = 100
    const DEPOSIT_FEE_POOL_SHARE_PERCENT = 25
    const WITHDRAW_ALLOWED_DAYS = 3
    const startTimestamp = 1648746001

    const allocationStaking = await deploy("AllocationStaking", {
        from: deployer,
        proxy: {
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [
                        avatTokenAddress,
                        distributionV2Address,
                        startTimestamp,
                        DEPOSIT_FEE_PERCENT,
                        DEPOSIT_FEE_PRECISION,
                        DEPOSIT_FEE_POOL_SHARE_PERCENT,
                        WITHDRAW_ALLOWED_DAYS,
                    ],
                },
            },
        },
        log: true,
    })

    if (allocationStaking.newlyDeployed) {
        const staking = (await ethers.getContractFactory("AllocationStaking")).attach(allocationStaking.address)

        const addPoolTx = await (await staking.add(100, avatTokenAddress, true)).wait()
        console.log(`add pool to allocation staking (tx: ${addPoolTx.transactionHash})`)

        const distributionV2Contract = (await ethers.getContractFactory("DistributionV2")).attach(distributionV2Address)

        const tx1 = await (await distributionV2Contract.setPool(allocationStaking.address, 50)).wait()
        console.log(`set allocation staking allocation in distribution (tx: ${tx1.transactionHash})`)

        const tx2 = await (await distributionV2Contract.addAdmin(allocationStaking.address)).wait()
        console.log(`set allocation staking as admin in distribution (tx: ${tx2.transactionHash})`)
    }
}

module.exports.tags = ["AllocationStaking"]
module.exports.dependencies = ["DistributionV2", "AvatToken"]
