import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

task("delete-liquidity-avax")
    .addParam("contract", "Contract address")
    .addParam("address", "The account's address")
    .addParam("token", "Token address")
    .addParam("liquidity", "Liquidity of pair of tokens")
    .addParam("amounttokenmin", "The minimal amount of tokens, that you desire to recieve")
    .addParam("amountavaxmin", "The minimal amount of tokens, that you desire to swap")
    .addParam("deadline", "Deadline to trade")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const saleMarketplaceContract = (await ethers.getContractFactory("LPRouter")).attach(taskArgs.contract)

        const tx = await (
            await saleMarketplaceContract.removeLiquidityAVAX(
                taskArgs.token,
                taskArgs.liquidity,
                taskArgs.amounttokenmin,
                taskArgs.amountavaxmin,
                taskArgs.address,
                taskArgs.deadline
            )
        ).wait()

        console.log(`LPRouter.addLiquidity: ${tx.transactionHash}`)
    })
