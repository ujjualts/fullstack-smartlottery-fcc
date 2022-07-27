const { assert,expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) 
    ? describe.skip 
    : describe("Raffle uint Tests", function () {
        let raffle;

        beforeEach( async() =>  {
            accounts = await ethers.getSigners()
            deloyer = accounts[0]
            player = accounts[1]
            await deployments.fixture(["mocks","raffle"])
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
            raffleContract = await ethers.getContract("Raffle")
            raffle = raffleContract.connect(player)
            raaffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("constructor", function () {
            it("intitiallizes the raffle correctly", async () => {
                const raffleState = (await raffle.getRaffleState()).toString()
                assert.equal(raffleState, "0")
                assert.equal(
                    interval.toString(),
                    networkConfig[network.config.chainId]["keepersUpdateInterval"]
                )
            })
        })

        describe("enterRaffle", function () {
            it("revert when you don't pay enough", async() => {
                await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__SendMoreToEnterRaffle()")
            })

            it("records player when they enter", async() => {
                await raffle.enterRaffle({ value: raaffleEntranceFee})
                const contractPlayer = await raffle.getPlayer(0)
                assert.equal(player.address,contractPlayer)
            })

            it("emit event on enter", async() => {
                await expect(raffle.enterRaffle({ value: raaffleEntranceFee})).to.emit(
                    raffle,
                    "RaffleEnter"
                )
            })

            it("doesn't allow entrance when raffle is calculating", async() => {
                await raffle.enterRaffle({ value: raaffleEntranceFee})
                await network.provider.send("evm_increaseTime",[interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: []})
                await raffle.performUpkeep([])
                await expect(raffle.enterRaffle({value: raaffleEntranceFee})).to.be.revertedWith("Raffle__RaffleNotOpen()")
            })
        })

        describe("checkUpkeep",function() {
            it("returns false if people haven't seen any ETH", async() => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
            })
            it("returns false if raffle isn't open", async () => {
                await raffle.enterRaffle({value: raaffleEntranceFee})
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                await raffle.performUpkeep([])
                const raffleState = await raffle.getRaffleState()
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert(!upkeepNeeded)
            })
            it("returns false if enough time hasn't passed", async () => {
                await raffle.enterRaffle({ value: raaffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await raffle.enterRaffle({ value: raaffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })

        describe("performUpkeep", function (){
            it("can only run if checkupkeep is true", async () => {
                await raffle.enterRaffle({value: raaffleEntranceFee})
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const tx = await raffle.performUpkeep("0x")
                assert(tx)
            })

            it("reverts if checkup is false", async () => {
                await expect(raffle.performUpkeep("0x")).to.be.revertedWith( 
                    "Raffle__UpkeepNotNeeded"
                )
            })

            it("updates the raffle state and emits a  requestId", async() => {
                await raffle.enterRaffle({value: raaffleEntranceFee})
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const txResponse = await raffle.performUpkeep("0x")
                const txReciept = await txResponse.wait(1)
                const raffleState = await raffle.getRaffleState()
                const requestId = txReciept.events[1].args.requestId

                assert(requestId.toNumber() > 0)
                assert(raffleState == 1)
                
            })
        })

        describe("fulfillRandomWords", function () {
            beforeEach(async () => {
                await raffle.enterRaffle({ value: raaffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
            })

            it("can only be called after performupkeep", async () => {
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
            })

            it("picks a winner, resets and sends money", async() => {
                const additionalEntrances = 3
                const startingIndex = 2
                for(let i = startingIndex;i<startingIndex+additionalEntrances;i++){
                    raffle = raffleContract.connect(accounts[i])
                    await raffle.enterRaffle({value: raaffleEntranceFee})
                }
                const startingTimeStamp = await raffle.getLastTimeStamp()

                await new Promise(async (resolve,reject) => {
                    raffle.once("WinnerPicked",async () => {

                        console.log("WinnerPicked event fired !")
                        
                        try{
                            const recentWinner = await raffle.getRecentWinner()
                            const raffleState = await raffle.getRaffleState()
                            const winnerBalance = await accounts[2].getBalance()
                            const endingTimeStamp = await raffle.getLastTimeStamp()
                            await expect(raffle.getPlayer(0)).to.be.reverted
                            assert.equal(recentWinner.toString(), accounts[2].address)
                              assert.equal(raffleState, 0)
                              assert.equal(
                                  winnerBalance.toString(), 
                                  startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                      .add(
                                          raaffleEntranceFee
                                              .mul(additionalEntrances)
                                              .add(raaffleEntranceFee)
                                      )
                                      .toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve()
                        } catch(e) {
                            reject(e)
                        }
                    })

                      const tx = await raffle.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      const startingBalance = await accounts[2].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                })
            })
            
        })

    })