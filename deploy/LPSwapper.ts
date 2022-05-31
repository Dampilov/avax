import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const factoryAddress = (await deployments.get("LPFactory")).address
    const wavaxAddress = (await deployments.get("WAVAX")).address

    const swapper = await deploy("LPSwapper", {
        from: deployer,
        args: [factoryAddress, wavaxAddress],
        log: true,
    })

    if (swapper.newlyDeployed) {
        const lpFactoryContract = (await ethers.getContractFactory("LPFactory")).attach(factoryAddress)

        const tx1 = await (await lpFactoryContract.setFeeTo(swapper.address)).wait()
        console.log(`set LP farming fee to LP swapper (tx: ${tx1.transactionHash})`)
    }
}

module.exports.tags = ["LPSwapper"]
module.exports.dependencies = ["LPFactory", "WAVAX"]
