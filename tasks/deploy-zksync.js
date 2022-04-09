const { task } = require('hardhat/config')
const { Deployer } = require('@matterlabs/hardhat-zksync-deploy')
const { Wallet } = require('zksync-web3')

task('deploy-router-zksync', 'Deploys the whole contracts suite and optionally verifies source code on Etherscan')
  .addParam('factoryAddress', 'The factory address')
  .addParam('nativeAssetWrapperAddress', 'The address of the contract that wraps the native asset in the target chain')
  .setAction(async (taskArguments, hre) => {
    const { nativeAssetWrapperAddress, factoryAddress } = taskArguments

    const wallet = new Wallet(process.env.PRIVATE_KEY)
    const deployer = new Deployer(hre, wallet)

    const accountAddress = wallet.address

    console.log('Using factory address:', nativeAssetWrapperAddress)
    console.log('Using account:', accountAddress)
    console.log()

    // periphery
    console.log('Deploying router')
    const routerContract = await deployer.deploy(await deployer.loadArtifact('DXswapRouter'), [
      factoryAddress,
      nativeAssetWrapperAddress
    ])

    console.log(`== Periphery ==`)
    console.log(`Router deployed at address ${routerContract.address}`)
  })
