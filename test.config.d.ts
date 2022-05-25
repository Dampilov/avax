import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { SalesFactory, Sale, AllocationStaking, AllocationStakingMock, FarmLensV2Mock, ERC20Mock, DistributionV2, FarmingFactory, Farming, AvatToken } from "./build/typechain"
import { SaleMarketplace } from "./build/typechain/SaleMarketplace"

declare module "mocha" {
    export interface Context {
        // SIGNERS
        signers: SignerWithAddress[]
        owner: SignerWithAddress
        alice: SignerWithAddress
        bob: SignerWithAddress
        carol: SignerWithAddress
        tema: SignerWithAddress
        misha: SignerWithAddress

        // CONTRACTS
        salesFactory: SalesFactory 
        sale: Sale
        avatToken: AvatToken
        distributionV2: DistributionV2
        farmingFactory: FarmingFactory
        farming1: Farming
        farming2: Farming
        farming3: Farming
        saleMarketplace: SaleMarketplace
        allocationStaking: AllocationStaking
        allocationStakingMock: AllocationStakingMock
        farmLensV2Mock: FarmLensV2Mock
        token1: ERC20Mock
        token2: ERC20Mock
        token3: ERC20Mock
        token4: ERC20Mock
        token5: ERC20Mock
    }
}