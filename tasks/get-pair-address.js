const { task } = require('hardhat/config')

task('get-pair-address')
  .addParam('routerAddress')
  .addParam('tokenA')
  .addParam('tokenB')
  .setAction(async (taskArguments, hre) => {
    const { routerAddress, tokenA, tokenB } = taskArguments
    const ruoterContract = new hre.web3.eth.Contract(
      require('../artifacts-zk/contracts/DXswapRouter.sol/DXswapRouter.json').abi,
      routerAddress
    )

    console.log(`pair address: ${await ruoterContract.methods.pairFor(tokenA, tokenB).call()}`)
    console.log(`init code pair hash:`, await ruoterContract.methods.data(tokenA, tokenB).call())
  })
