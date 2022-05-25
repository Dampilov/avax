import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, getChainId } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    let farmLensV2Address = "farmLensV2Address"
    let signatory = "signatory"
    const chainId = await getChainId()

    // If mainnet
    if (chainId === "43114") {
        farmLensV2Address = "0xF16d25Eba0D8E51cEAF480141bAf577aE55bfdd2"
        signatory = "0xAD1aa367A59E79F4BAD3eF8DEB058bB75149b139"
    }

    // If fuji
    if (chainId === "43113") {
        farmLensV2Address = (await deployments.get("FarmLensV2Mock")).address
        signatory = "0x513b8169A1C414ce8898D990D6DFDaeA6B79cd3D"
    }

    const allocationStaking = (await deployments.get("AllocationStaking")).address

    await deploy("SalesFactory", {
        from: deployer,
        args: [allocationStaking, signatory, farmLensV2Address],
        log: true,
    })
}

module.exports.tags = ["SalesFactory"]
module.exports.dependencies = ["FarmLensV2Mock", "AllocationStaking"]
