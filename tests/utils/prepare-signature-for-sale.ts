import { ethers } from "hardhat"
import { duration, latest } from "./time"

export async function prepareSignatureForLotteryAllocation(participant: string, amount: number, signatory: string, saleAddress: string) {
    const domain = [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
    ]

    const permit = [
        { name: "participant", type: "address" },
        { name: "tokenAmount", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ]

    const domainData = {
        name: "Avata Sale",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: saleAddress,
    }

    const message = {
        participant,
        tokenAmount: amount,
        deadline: (await latest()).add(duration.hours("1")).toNumber(),
    }

    const data = JSON.stringify({
        types: {
            EIP712Domain: domain,
            Permit: permit,
        },
        domain: domainData,
        primaryType: "Permit",
        message: message,
    })

    const res = await ethers.provider.send("eth_signTypedData_v4", [signatory, data])

    const signature = res.substring(2)
    const v = parseInt(signature.substring(128, 130), 16)
    const r = "0x" + signature.substring(0, 64)
    const s = "0x" + signature.substring(64, 128)

    return {
        participant,
        tokenAmount: message.tokenAmount,
        deadline: message.deadline,
        v,
        r,
        s,
    }
}

export async function prepareSignatureForBuyToken(participant: string, signatory: string, saleAddress: string) {
    const domain = [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
    ]

    const permit = [
        { name: "participant", type: "address" },
        { name: "deadline", type: "uint256" },
    ]

    const domainData = {
        name: "Avata Sale",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: saleAddress,
    }

    const message = {
        participant,
        deadline: (await latest()).add(duration.hours("1")).toNumber(),
    }

    const data = JSON.stringify({
        types: {
            EIP712Domain: domain,
            Permit: permit,
        },
        domain: domainData,
        primaryType: "Permit",
        message: message,
    })

    const res = await ethers.provider.send("eth_signTypedData_v4", [signatory, data])

    const signature = res.substring(2)
    const v = parseInt(signature.substring(128, 130), 16)
    const r = "0x" + signature.substring(0, 64)
    const s = "0x" + signature.substring(64, 128)

    return {
        participant,
        deadline: message.deadline,
        v,
        r,
        s,
    }
}
