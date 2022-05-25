import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

task("sale-marketplace:set-whitelist-address")
    .addParam("contract", "Contract address")
    .addParam("address", "The account's address")
    .addParam("flag", "true/false statement")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const saleMarketplaceContract = (await ethers.getContractFactory("SaleMarketplace")).attach(taskArgs.contract)

        const tx = await (await saleMarketplaceContract.setWhitelistAddress(taskArgs.address, taskArgs.flag)).wait()

        console.log(`SaleMarketplace.setWhitelistAddress: ${tx.transactionHash}`)
    })
