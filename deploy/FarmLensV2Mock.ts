import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    await deploy("FarmLensV2Mock", {
        from: deployer,
        log: true,
    })
}

module.exports.tags = ["FarmLensV2Mock"]
module.exports.skip = async (hre: HardhatRuntimeEnvironment) => (await hre.getChainId()) === "43114"
