import chai, { expect } from 'chai'
import { constants, Contract, ethers, utils, Wallet } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, Interface } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { expandTo18Decimals, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { dxswapFixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('DXswapSwapRelayer', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, wallet2, wallet3] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let token0: Contract
  let token1: Contract
  let weth: Contract
  let wethPartner: Contract
  let wethPair: Contract
  let uniWethPair: Contract
  let dxswapPair: Contract
  let dxswapFactory: Contract
  let dxswapRouter: Contract
  let uniPair: Contract
  let uniFactory: Contract
  let uniRouter: Contract
  let uniRouterUniFactory: Contract
  let oracleCreator: Contract
  let dxRelayer: Contract
  let owner: String

  async function addLiquidity(amount0: BigNumber = defaultAmountALiquidity, amount1: BigNumber = defaultAmountBLiquidity) {
    if (!amount0.isZero()) await token0.transfer(dxswapPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(dxswapPair.address, amount1)
    await dxswapPair.mint(dxRelayer.address, overrides)
  }

  async function addLiquidityUniswap(amount0: BigNumber = defaultAmountALiquidity, amount1: BigNumber = defaultAmountBLiquidity) {
    if (!amount0.isZero()) await token0.transfer(uniPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(uniPair.address, amount1)
    await uniPair.mint(dxRelayer.address, overrides)
  }

  const defaultAmountIn = expandTo18Decimals(2)
  const defaultAmountOut = 0
  const defaultAmountALiquidity = expandTo18Decimals(10)
  const defaultAmountBLiquidity = expandTo18Decimals(10)
  const expectedLiquidity = expandTo18Decimals(2)
  const defaultPriceTolerance = 10000 // 1%
  const defaultMinReserve = expandTo18Decimals(2)
  const defaultMaxWindowTime = 300 // 5 Minutes
  const GAS_ORACLE_UPDATE = 168317;
  const GAS_SWAP = 1979326544;

  beforeEach('deploy fixture', async function () {
    const fixture = await loadFixture(dxswapFixture)
    token0 = fixture.token0
    token1 = fixture.token1
    weth = fixture.WETH
    wethPartner = fixture.WETHPartner
    wethPair = fixture.WETHPair
    uniWethPair = fixture.uniWETHPair
    dxswapPair = fixture.pair
    dxswapFactory = fixture.dxswapFactory
    dxswapRouter = fixture.dxswapRouter
    uniPair = fixture.uniPair
    uniFactory = fixture.uniFactory
    uniRouter = fixture.uniRouter
    uniRouterUniFactory = fixture.uniRouterUniFactory
    oracleCreator = fixture.oracleCreator
    dxRelayer = fixture.dxSwapRelayer
  })

  beforeEach('fund the relayer contract to spend ERC20s and ETH', async () => {
    await token0.transfer(dxRelayer.address, expandTo18Decimals(999))
    await token1.transfer(dxRelayer.address, expandTo18Decimals(999))
    await wethPartner.transfer(dxRelayer.address, expandTo18Decimals(999))
    await wallet2.sendTransaction({
      to: dxRelayer.address,
      value: utils.parseEther('500')
    })
    owner = await dxRelayer.owner()
  })

  // 1/1/2020 @ 12:00 am UTC
  // cannot be 0 because that instructs ganache to set it to current timestamp
  // cannot be 86400 because then timestamp 0 is a valid historical observation
  const startTime = 1577836800
  const defaultDeadline = 1577836800 + 86400 // 24 hours

  // must come before adding liquidity to pairs for correct cumulative price computations
  // cannot use 0 because that resets to current timestamp
  beforeEach(`set start time to ${startTime}`, () => mineBlock(provider, startTime))

  describe('Input conditions', () => {
    it('requires correct order input', async () => {
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_FACTORY')

      const dxRelayerFromWallet2 = dxRelayer.connect(wallet2)
      await expect(
        dxRelayerFromWallet2.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: CALLER_NOT_OWNER')

      await expect(
        dxRelayer.createSwapOrder(
          token1.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_PAIR')

      await expect(
        dxRelayer.createSwapOrder(
          token1.address,
          token0.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          0,
          0,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_AMOUNT')

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountIn,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_AMOUNT')

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOLERANCE')

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          1577836800,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: DEADLINE_REACHED')
    })

    it('requires sufficient ETH balance', async () => {
      await expect(
        dxRelayer.createSwapOrder(
          AddressZero,
          wethPartner.address,
          expandTo18Decimals(1243),
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INSUFFICIENT_ETH')
    })
    it('requires existing pool address', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(wethPair.address, expandTo18Decimals(400))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(400))

      await expect(
        dxRelayer.createSwapOrder(
          AddressZero,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.be.revertedWith('DXswapRelayer: INVALID_POOL_ADDRESS')
    })
  })

  describe('Swap transactions', () => {
    it('swap ERC20/ERC20 pair on Uniswap tokenA -> tokenB', async () => {
      const startBalance0 = await token0.balanceOf(dxRelayer.address)
      const startBalance1 = await token1.balanceOf(dxRelayer.address)
      const liquidityToken0 = expandTo18Decimals(800)
      const liquidityToken1 = expandTo18Decimals(800)

      await addLiquidityUniswap(liquidityToken0, liquidityToken1)

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await uniPair.swapFee();
      const amountOut = await uniRouterUniFactory.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(uniPair, 'Swap')
        .withArgs(uniRouterUniFactory.address, defaultAmountIn, 0, 0, amountOut, dxRelayer.address)

      expect(await token0.balanceOf(dxRelayer.address)).to.eq(startBalance0.sub(defaultAmountIn))
      expect(await token1.balanceOf(dxRelayer.address)).to.eq(startBalance1.add(amountOut))

    })

    it('swap ERC20/ERC20 pair on Uniswap tokenB -> tokenA', async () => {
      const startBalance0 = await token0.balanceOf(dxRelayer.address)
      const startBalance1 = await token1.balanceOf(dxRelayer.address)
      const liquidityToken0 = expandTo18Decimals(800)
      const liquidityToken1 = expandTo18Decimals(800)

      await addLiquidityUniswap(liquidityToken0, liquidityToken1)

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountOut,
          defaultAmountIn,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await uniPair.swapFee();
      const amountOut = await uniRouterUniFactory.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(uniPair, 'Swap')
        .withArgs(uniRouterUniFactory.address, 0, defaultAmountIn, amountOut, 0, dxRelayer.address)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await token0.balanceOf(dxRelayer.address)).to.eq(startBalance0.add(amountOut))
      expect(await token1.balanceOf(dxRelayer.address)).to.eq(startBalance1.sub(defaultAmountIn))

    })

    it('swap ERC20/ERC20 DXswap with price = 2', async () => {
      const startBalance0 = await token0.balanceOf(dxRelayer.address)
      const startBalance1 = await token1.balanceOf(dxRelayer.address)
      const liquidityToken0 = expandTo18Decimals(400)
      const liquidityToken1 = expandTo18Decimals(800)

      await addLiquidity(liquidityToken0, liquidityToken1)
      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await dxswapPair.swapFee();
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, defaultAmountIn, 0, 0, amountOut, dxRelayer.address)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await token0.balanceOf(dxRelayer.address)).to.eq(startBalance0.sub(defaultAmountIn))
      expect(await token1.balanceOf(dxRelayer.address)).to.eq(startBalance1.add(amountOut))
    })

    it('swap ERC20/ERC20 DXswap with random price tokenB -> tokenA', async () => {
      const startBalance0 = await token0.balanceOf(dxRelayer.address)
      const startBalance1 = await token1.balanceOf(dxRelayer.address)
      const liquidityToken0 = expandTo18Decimals(577)
      const liquidityToken1 = expandTo18Decimals(808)

      await addLiquidity(liquidityToken0, liquidityToken1)
      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountOut,
          defaultAmountIn,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await dxswapPair.swapFee()
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, liquidityToken1, liquidityToken0, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, 0, defaultAmountIn, amountOut, 0, dxRelayer.address)

      expect(await token0.balanceOf(dxRelayer.address)).to.eq(startBalance0.add(amountOut))
      expect(await token1.balanceOf(dxRelayer.address)).to.eq(startBalance1.sub(defaultAmountIn))
    })

    it('swap ERC20/ERC20 DXswap with price = 1 tokenB -> tokenA', async () => {
      const startBalance0 = await token0.balanceOf(dxRelayer.address)
      const startBalance1 = await token1.balanceOf(dxRelayer.address)
      const liquidityToken0 = expandTo18Decimals(900)
      const liquidityToken1 = expandTo18Decimals(900)

      await addLiquidity(liquidityToken0, liquidityToken1)

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountOut,
          defaultAmountIn,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await dxswapPair.swapFee();
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, 0, defaultAmountIn, amountOut, 0, dxRelayer.address)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await token0.balanceOf(dxRelayer.address)).to.eq(startBalance0.add(amountOut))
      expect(await token1.balanceOf(dxRelayer.address)).to.eq(startBalance1.sub(defaultAmountIn))

    })

    it('swap ETH/ERC20 DXswap', async () => {
      const liquidityToken0 = expandTo18Decimals(400)
      const liquidityToken1 = expandTo18Decimals(400)

      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(wethPair.address, liquidityToken0)
      await wethPartner.transfer(wethPair.address, liquidityToken1)
      await wethPair.mint(dxRelayer.address, overrides)
      const startBalance0 = await provider.getBalance(dxRelayer.address)
      const startBalance1 = await wethPartner.balanceOf(dxRelayer.address)

      await expect(
        dxRelayer.createSwapOrder(
          AddressZero,
          wethPartner.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address)
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)


      await mineBlock(provider, startTime + 10)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await wethPair.swapFee()
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Swap')
        .withArgs(dxswapRouter.address, 0, defaultAmountIn, amountOut, 0, dxRelayer.address)

      expect(await provider.getBalance(dxRelayer.address)).to.lt(startBalance0.sub(defaultAmountIn))
      expect(await wethPartner.balanceOf(dxRelayer.address)).to.eq(startBalance1.add(amountOut))
    })

    it('swap ETH/ERC20 Uniswap', async () => {
      const liquidityToken0 = expandTo18Decimals(400)
      const liquidityToken1 = expandTo18Decimals(400)

      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(uniWethPair.address, liquidityToken0)
      await wethPartner.transfer(uniWethPair.address, liquidityToken1)
      await uniWethPair.mint(dxRelayer.address, overrides)

      const startBalance0 = await provider.getBalance(dxRelayer.address)
      const startBalance1 = await wethPartner.balanceOf(dxRelayer.address)

      await addLiquidityUniswap(expandTo18Decimals(800), expandTo18Decimals(800))

      await expect(
        dxRelayer.createSwapOrder(
          AddressZero,
          wethPartner.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)


      await mineBlock(provider, startTime + 10)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await uniWethPair.swapFee()
      const amountOut = await uniRouterUniFactory.getAmountOut(defaultAmountIn, liquidityToken0, liquidityToken1, fee)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(uniWethPair, 'Swap')
        .withArgs(uniRouterUniFactory.address, 0, defaultAmountIn, amountOut, 0, dxRelayer.address)

      expect(await provider.getBalance(dxRelayer.address)).to.lt(startBalance0.sub(defaultAmountIn))
      expect(await wethPartner.balanceOf(dxRelayer.address)).to.eq(startBalance1.add(amountOut))

    })
  })

  describe('Oracle price calculation', () => {
    it('reverts oracle update if minReserve is not reached', async () => {
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await expect(dxRelayer.updateOracle(0)).to.be.revertedWith('DXswapRelayer: RESERVE_TOO_LOW')
    })

    it('updates price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayer.updateOracle(0)
      await expect(dxRelayer.updateOracle(0)).to.be.revertedWith('OracleCreator: PERIOD_NOT_ELAPSED')
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
    })

    it('consumes 168317 to update the price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      let tx = await dxRelayer.updateOracle(0)
      let receipt = await provider.getTransactionReceipt(tx.hash)
      expect(receipt.gasUsed).to.eq(bigNumberify(GAS_ORACLE_UPDATE))
    })
  })

  describe('Ownership and deadlines', () => {
    it('withdraws an order after expiration', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      const startBalance0 = await token0.balanceOf(owner)
      const startBalance1 = await token1.balanceOf(owner)

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await mineBlock(provider, startTime + 10)
      await dxRelayer.updateOracle(0)
      await expect(dxRelayer.withdrawExpiredOrder(0)).to.be.revertedWith('DXswapRelayer: DEADLINE_NOT_REACHED')
      await mineBlock(provider, defaultDeadline + 500)
      await dxRelayer.withdrawExpiredOrder(0)
      expect(await token0.balanceOf(owner)).to.eq(startBalance0.add(defaultAmountIn))
      expect(await token1.balanceOf(owner)).to.eq(startBalance1.add(defaultAmountOut))
    })

    it('should let the owner transfer ownership', async () => {
      const oldOwner = await dxRelayer.owner()
      const newOwner = token0.address
      await expect(dxRelayer.transferOwnership(newOwner))
        .to.emit(dxRelayer, 'OwnershipTransferred')
        .withArgs(oldOwner, newOwner)
      expect(await dxRelayer.owner()).to.be.equal(newOwner)
    })

    it('require owner to transfer ownership', async () => {
      const dxRelayerFromWallet2 = dxRelayer.connect(wallet2)
      const newOwner = token1.address
      await expect(dxRelayerFromWallet2.transferOwnership(newOwner))
        .to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('require oracle.update caller to be owner', async () => {
      const dxRelayerFromWallet2 = dxRelayer.connect(wallet2)
      const oracleCreatorFromWallet2 = oracleCreator.connect(wallet2)
      await addLiquidityUniswap(expandTo18Decimals(800), expandTo18Decimals(800))

      await mineBlock(provider, startTime + 10)

      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await expect(oracleCreatorFromWallet2.update(0))
        .to.be.revertedWith('OracleCreator: CALLER_NOT_OWNER')
    })

    it('require oracle updater gets bounty', async () => {
      const dxRelayerFromWallet3 = dxRelayer.connect(wallet3)
      const startBalance = await provider.getBalance(wallet3.address)

      await addLiquidityUniswap(expandTo18Decimals(800), expandTo18Decimals(800))

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayerFromWallet3.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayerFromWallet3.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      expect(await provider.getBalance(wallet3.address)).to.gt(startBalance)
    })

    it('require observation finalized', async () => {
      const dxRelayerFromWallet3 = dxRelayer.connect(wallet3)
      await addLiquidityUniswap(expandTo18Decimals(800), expandTo18Decimals(800))

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayerFromWallet3.updateOracle(0)
      await mineBlock(provider, startTime + 350)

      await expect(dxRelayer.executeOrder(0))
        .to.be.revertedWith('DXswapRelayer: OBSERVATION_RUNNING')
    })

    it('require observations < 2', async () => {
      const dxRelayerFromWallet3 = dxRelayer.connect(wallet3)
      await addLiquidityUniswap(expandTo18Decimals(800), expandTo18Decimals(800))

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOut,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0)

      await dxRelayerFromWallet3.updateOracle(0)
      await mineBlock(provider, startTime + 350)

      await dxRelayerFromWallet3.updateOracle(0)
      await mineBlock(provider, startTime + 350)

      await expect(dxRelayerFromWallet3.updateOracle(0))
        .to.be.revertedWith('DXswapRelayer: OBSERVATION_ENDED')
    })
  })
})