import { HardhatRuntimeEnvironment } from "hardhat/types"

module.exports = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre
    const { deploy } = deployments

    const { deployer } = await getNamedAccounts()

    const salesFactory = (await deployments.get("SalesFactory")).address

    const saleMarketplace = await deploy("SaleMarketplace", {
        from: deployer,
        args: [salesFactory],
        log: true,
    })

    if (saleMarketplace.newlyDeployed) {
        const saleMarketplaceContract = (await ethers.getContractFactory("SaleMarketplace")).attach(saleMarketplace.address)

        const tokens = ["0x8e035c35385fcef8D03a9d748ef342F8035F6367", "0x258Fbb5c0fd6fF4edE775d92b8D564832FB5Ef5b"]

        for (const token of tokens) {
            const { transactionHash } = await (await saleMarketplaceContract.setWhitelistAddress(token, true)).wait()
            console.log(`set whitelist address in marketplace (tx: ${transactionHash})`)
        }
    }
}

module.exports.tags = ["SaleMarketplace"]
module.exports.dependencies = ["SalesFactory"]
