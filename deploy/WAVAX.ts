import { readFileSync } from "fs"
import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    if ((await hre.getChainId()) == "43114") {
        const wavax = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"

        deployments.save("WAVAX", {
            address: wavax,
            abi: JSON.parse(readFileSync(`${__dirname}/../build/abis/WAVAXMock.json`, "utf8")),
        })

        console.log(`reusing "WAVAX" at ${wavax}`)
        return
    }

    await deploy("WAVAX", {
        contract: "WAVAXMock",
        from: deployer,
        log: true,
    })
}

module.exports.tags = ["WAVAX"]
