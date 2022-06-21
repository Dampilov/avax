import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

task("create-liquidity")
    .addParam("contract", "Contract address")
    .addParam("address", "The account's address")
    .addParam("tokena", "Token A address")
    .addParam("tokenb", "Token B address")
    .addParam("amountadesired", "The amount of tokens, that you desire to recieve")
    .addParam("amountbdesired", "The amount of tokens, that you desire to swap")
    .addParam("amountamin", "The minimal amount of tokens, that you desire to recieve")
    .addParam("amountbmin", "The minimal amount of tokens, that you desire to swap")
    .addParam("deadline", "Deadline to trade")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const saleMarketplaceContract = (await ethers.getContractFactory("LPRouter")).attach(taskArgs.contract)

        const tx = await (
            await saleMarketplaceContract.addLiquidity(
                taskArgs.tokena,
                taskArgs.tokenb,
                taskArgs.amountadesired,
                taskArgs.amountbdesired,
                taskArgs.amountamin,
                taskArgs.amountbmin,
                taskArgs.address,
                taskArgs.deadline
            )
        ).wait()

        console.log(`LPRouter.addLiquidity: ${tx.transactionHash}`)
    })
