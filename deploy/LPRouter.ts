import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const wavaxAddress = (await deployments.get("WAVAX")).address
    const factoryAddress = (await deployments.get("LPFactory")).address

    await deploy("LPRouter", {
        from: deployer,
        args: [factoryAddress, wavaxAddress],
        log: true,
    })
}

module.exports.tags = ["LPRouter"]
module.exports.dependencies = ["LPFactory", "WAVAX"]
