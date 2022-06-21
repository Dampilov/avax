import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

task("create-liquidity-avax")
    .addParam("contract", "Contract address")
    .addParam("address", "The account's address")
    .addParam("token", "Token address")
    .addParam("amounttokendesired", "The amount of tokens, that you desire to recieve")
    .addParam("amounttokenmin", "The minimal amount of tokens, that you desire to recieve")
    .addParam("amountavaxmin", "The minimal amount of AVAX, that you desire to swap")
    .addParam("deadline", "Deadline to trade")
    .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const saleMarketplaceContract = (await ethers.getContractFactory("LPRouter")).attach(taskArgs.contract)

        const tx = await (
            await saleMarketplaceContract.addLiquidityAVAX(
                taskArgs.token,
                taskArgs.amounttokendesired,
                taskArgs.amounttokenmin,
                taskArgs.amountavaxmin,
                taskArgs.address,
                taskArgs.deadline
            )
        ).wait()

        console.log(`LPRouter.addLiquidityAVAX: ${tx.transactionHash}`)
    })
