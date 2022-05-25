import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, getChainId, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const avatToken = (await deployments.get("AvatToken")).address
    const distributionV2 = (await deployments.get("DistributionV2")).address

    const farmingFactory = await deploy("FarmingFactory", {
        from: deployer,
        args: [avatToken, distributionV2],
        log: true,
    })

    if (farmingFactory.newlyDeployed) {
        const distributionV2Contract = (await ethers.getContractFactory("DistributionV2")).attach(distributionV2)

        const tx1 = await (await distributionV2Contract.setPool(farmingFactory.address, 50)).wait()
        console.log(`set farming allocation in distribution (tx: ${tx1.transactionHash})`)

        const tx2 = await (await distributionV2Contract.addAdmin(farmingFactory.address)).wait()
        console.log(`set farming as admin in distribution (tx: ${tx2.transactionHash})`)
    }
}

module.exports.tags = ["FarmingFactory"]
module.exports.dependencies = ["AvatToken", "DistributionV2"]
