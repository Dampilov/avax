import { readFileSync } from "fs"
import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    if ((await hre.getChainId()) == "43114") {
        const avatTokenAddress = "0x7086C48c997b8597a1692798155B4fCf2cee7F0f"

        deployments.save("AvatToken", {
            address: avatTokenAddress,
            abi: JSON.parse(readFileSync(`${__dirname}/../build/abis/AvatToken.json`, "utf8")),
        })

        console.log(`reusing "AvatToken" at ${avatTokenAddress}`)
        return
    }

    const avatName = "AVAT"
    const avatSymbol = "AVAT"
    const avatTotalCap = ethers.utils.parseUnits("100000000", 6)
    const avatInitialMint = ethers.utils.parseUnits("4235881", 6)

    await deploy("AvatToken", {
        args: [avatName, avatSymbol, avatInitialMint, avatTotalCap],
        from: deployer,
        log: true,
    })
}

module.exports.tags = ["AvatToken"]
