const { getNamedAccounts,deployments,network,run, ethers } = require("hardhat")
const {
    networkConfig,
    developmentChains,
    VERIFICATION_BLOCK_CONFIRMATION
} = require("../helper-hardhat-config");
const { verify } = require("..utils/verify")

const FUND_AMOUNT = "1000000000000000000000"

module.exports = async function({getNamedAccounts,deployments}) {{

    const {deploy,log} = deployments
    const {deployments} = await getNamedAccounts()
    const chainId = network.config.chainId
    let vrfCoordinatorV2Address,subscriptionId

    if(developmentChains.includes(network.name)) {
        const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
        vrfCoordinatorV2Mock = vrfCoordinatorV2Mock.address
        const transactionResponse = await vrfCoordinatorV2Mock.createSubscription()
        const transactionReciept = await transactionResponse.wait()
        subscriptionId = transactionReciept.event[0].args.subId
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, FUND_AMOUNT)
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatiorV2"]
        subscriptionId = networkConfig[chainId]["subscriptionId"]
    }

    const waitBlockConfirmations = developmentChains.includes(network.name) ? 1 : VERIFICATION_BLOCK_CONFIRMATION

    log("---------------------------------")
    const arguments = [
        vrfCoordinatorV2Address,
        subscriptionId,
        networkConfig[chainId]["gasLane"],
        networkConfig[chainId]["keepersUpdateInterval"],
        networkConfig[chainId]["raffleEntranceFee"],
        networkConfig[chainId]["callbackGasLimit"],
    ]

    const raffle = await deploy("Raffle", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: waitBlockConfirmations,
    })

    if(!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        log("verifying...")
        await verify(raffle.address,arguments)
    }

    log("Enter lottery with command:")
    const networkName = network.name == "hardhat" ? "localhost" : network.name
    log(`yarn hardhat run scripts/enterRaffle.js --network ${networkName}`)
    log("----------------------------------------------------")

}}

module.exports.tags = ["all","raffle"]