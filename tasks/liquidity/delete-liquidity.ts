import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

task("delete-liquidity")
    .addParam("contract", "Contract address")
    .addParam("address", "The account's address")
    .addParam("tokena", "Token A address")
    .addParam("tokenb", "Token B address")
    .addParam("liquidity", "Liquidity of pair of tokens")
    .addParam("amountamin", "The minimal amount of tokens, that you desire to swap")
    .addParam("amountbmin", "The minimal amount of tokens, that you desire to swap")
    .addParam("deadline", "Deadline to trade")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const saleMarketplaceContract = (await ethers.getContractFactory("LPRouter")).attach(taskArgs.contract)

        const tx = await (
            await saleMarketplaceContract.removeLiquidity(
                taskArgs.tokena,
                taskArgs.tokenb,
                taskArgs.liquidity,
                taskArgs.amountamin,
                taskArgs.amountbmin,
                taskArgs.address,
                taskArgs.deadline
            )
        ).wait()

        console.log(`LPRouter.addLiquidity: ${tx.transactionHash}`)
    })
