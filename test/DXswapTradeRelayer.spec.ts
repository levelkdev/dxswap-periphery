import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, utils, BigNumber } from 'ethers'
import { expect } from 'chai'
import { ethers } from 'hardhat';
import { Address } from 'hardhat-deploy/dist/types'
import { dxswapFixture } from './shared/fixtures'
import { expandTo18Decimals, mineBlock } from './shared/utilities'
import { DXswapFactory, DXswapPair, DXswapRouter, ERC20Mintable, OracleCreator, DXswapTradeRelayer, WETH9 } from './../typechain'

const { AddressZero } = constants

const overrides = {
  gasLimit: 14999999
}

describe('DXswapTradeRelayer', () => {
  let token0: ERC20Mintable
  let token1: ERC20Mintable
  let token2: ERC20Mintable
  let weth: WETH9
  let wethPartner: ERC20Mintable
  let wethPair: DXswapPair
  let uniWethPair: DXswapPair
  let dxswapPair: DXswapPair
  let dxswapFactory: DXswapFactory
  let dxswapRouter: DXswapRouter
  let uniPair: DXswapPair
  let uniFactory: DXswapFactory
  let uniRouter: DXswapRouter
  let oracleCreator: OracleCreator
  let dxTrade: DXswapTradeRelayer
  let owner: Address

  let dxdao: SignerWithAddress
  let wallet2: SignerWithAddress

  let initBalanceTokenIn: BigNumber
  let initBalanceTokenOut: BigNumber
  let amountToken0: BigNumber
  let amountToken1: BigNumber

  async function addLiquidity(amount0: BigNumber = defaultAmountALiquidity, amount1: BigNumber = defaultAmountBLiquidity) {
    if (!amount0.isZero()) await token0.transfer(dxswapPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(dxswapPair.address, amount1)
    await dxswapPair.mint(dxTrade.address, overrides)
  }

  const defaultAmountIn = expandTo18Decimals(3)
  const defaultAmountOutZero = expandTo18Decimals(0)
  const defaultAmountALiquidity = expandTo18Decimals(10)
  const defaultAmountBLiquidity = expandTo18Decimals(10)
  const expectedLiquidity = expandTo18Decimals(2)
  const defaultPriceTolerance = 10000 // 10000 = 1%
  const defaultMinReserve = expandTo18Decimals(1)
  const defaultMaxWindowTime = 300 // 5 Minutes
  const GAS_ORACLE_UPDATE = 179019; 
  const provider = ethers.provider

  // 1/1/2020 @ 12:00 am UTC
  // cannot be 0 because that instructs ganache to set it to current timestamp
  // cannot be 86400 because then timestamp 0 is a valid historical observation
  let startTime = 1893499200
  let defaultDeadline = startTime + 86400 // 24 hours

  // must come before adding liquidity to pairs for correct cumulative price computations
  // cannot use 0 because that resets to current timestamp
  // beforeEach(`set start time to ${startTime}`, async () => await mineBlock(provider, startTime))

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    wallet2 = signers[1]
  })

  beforeEach('deploy fixture', async function () {
    const fixture = await dxswapFixture(dxdao)
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
    weth = fixture.WETH
    wethPartner = fixture.WETHPartner
    wethPair = fixture.WETHPair
    uniWethPair = fixture.uniWETHPair
    dxswapPair = fixture.dxswapPair
    dxswapFactory = fixture.dxswapFactory
    dxswapRouter = fixture.dxswapRouter
    uniRouter = fixture.uniRouter
    uniPair = fixture.uniPair
    uniFactory = fixture.uniFactory
    oracleCreator = fixture.oracleCreator
    dxTrade = fixture.dxTrade

  })

  beforeEach('fund the relayer contract to spend ERC20s and ETH', async () => {
    await token0.transfer(dxTrade.address, expandTo18Decimals(1000))
    await token1.transfer(dxTrade.address, expandTo18Decimals(1000))
    await wethPartner.transfer(dxTrade.address, expandTo18Decimals(1000))
    await wallet2.sendTransaction({
      to: dxTrade.address,
      value: utils.parseEther('50')
    })
    owner = await dxTrade.owner()
  })

  beforeEach('set timestamp', async () => {
    const lastTime = (await provider.getBlock("latest")).timestamp;
    startTime = lastTime;
    defaultDeadline = startTime + 86400
  })

  describe('Input conditions', () => {
    it('require correct INIT_CODE_PAIR_HASH', async () => {
      expect(await dxswapFactory.INIT_CODE_PAIR_HASH()).to.be.equal('0xc30284a6e09f4f63686442b7046014b946fdb3e6c00d48b549eda87070a98167')
    })

    it('requires correct order input', async () => {
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_FACTORY')

      const dxTradeFromWallet2 = dxTrade.connect(wallet2)
      await expect(
        dxTradeFromWallet2.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: CALLER_NOT_OWNER')

      await expect(
        dxTrade.createSwapOrder(
          token1.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_PAIR')

      await expect(
        dxTrade.createSwapOrder(
          token1.address,
          token0.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dxTrade.createSwapOrder(
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
        dxTrade.createSwapOrder(
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
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOLERANCE')

      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
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
        dxTrade.createSwapOrder(
          AddressZero,
          wethPartner.address,
          expandTo18Decimals(1243),
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INSUFFICIENT_ETH')
    })
  })

  describe('Swap transactions', () => {
    it('swap ERC20/ERC20 pair on Uniswap tokenA -> tokenB', async () => {
      initBalanceTokenIn = await token0.balanceOf(dxTrade.address);
      initBalanceTokenOut = await token1.balanceOf(dxTrade.address);
      amountToken0 = expandTo18Decimals(880)
      amountToken1 = expandTo18Decimals(880)
      // add liquidity to uniswap to provide oracle 
      await token0.transfer(uniPair.address, amountToken0)
      await token1.transfer(uniPair.address, amountToken1)
      // mint lp tokens for dxdao
      await uniPair.mint(dxTrade.address, overrides)

      await mineBlock(provider, startTime + 10)
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await uniPair.swapFee()
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, amountToken0, amountToken1, fee)

      await expect(dxTrade.executeOrder(0, overrides))
        .to.emit(dxTrade, 'ExecutedOrder')
        .withArgs(0)

      expect(await token0.balanceOf(dxTrade.address)).to.eq(initBalanceTokenIn.sub(defaultAmountIn));
      expect(await token1.balanceOf(dxTrade.address)).to.eq(initBalanceTokenIn.add(amountOut))
    })

    it('swap ERC20/ERC20 DXswap with price = 2', async () => {
      initBalanceTokenIn = await token0.balanceOf(dxTrade.address);
      initBalanceTokenOut = await token1.balanceOf(dxTrade.address);
      await addLiquidity(expandTo18Decimals(400), expandTo18Decimals(800))
      await mineBlock(provider, startTime + 10)
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      const fee = await dxswapPair.swapFee();
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, expandTo18Decimals(400), expandTo18Decimals(800), fee)

      await expect(dxTrade.executeOrder(0, overrides))
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, defaultAmountIn, 0, 0, amountOut, dxTrade.address)
        .to.emit(dxTrade, 'ExecutedOrder')
        .withArgs(0)

      expect(await token0.balanceOf(dxTrade.address)).to.eq(initBalanceTokenIn.sub(defaultAmountIn))
      expect(await token1.balanceOf(dxTrade.address)).to.eq(initBalanceTokenOut.add(amountOut))
    })

    it('swap ETH/ERC20 pair on Uniswap', async () => {
      // get addresses of sorted pair tokens
      const token0Address = await uniWethPair.token0()
      const token0 = weth.address === token0Address ? weth : wethPartner
      const token1 = weth.address === token0Address ? wethPartner : weth

      amountToken0 = expandTo18Decimals(480)
      amountToken1 = expandTo18Decimals(480)

      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(uniWethPair.address, amountToken0)
      await wethPartner.transfer(uniWethPair.address, amountToken1)
      await uniWethPair.mint(dxdao.address)

      await expect(
        dxTrade.createSwapOrder(
          AddressZero,
          wethPartner.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await mineBlock(provider, startTime + 10)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await uniWethPair.swapFee()
      const amountOut = await uniRouter.getAmountOut(defaultAmountIn, amountToken0, amountToken1, fee)

      initBalanceTokenIn = await provider.getBalance(dxTrade.address)
      initBalanceTokenOut = await wethPartner.balanceOf(dxTrade.address);

      await expect(dxTrade.executeOrder(0, overrides))
        .to.emit(dxTrade, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(uniWethPair, 'Sync')
        .withArgs(await token0.balanceOf(uniWethPair.address), await token1.balanceOf(uniWethPair.address))

      // dxTrade contract balance
      expect(await wethPartner.balanceOf(dxTrade.address)).to.eq(initBalanceTokenOut.add(amountOut))
      expect(await provider.getBalance(dxTrade.address)).to.eq(initBalanceTokenIn.sub(defaultAmountIn))

      // pool balance
      expect(await wethPartner.balanceOf(uniWethPair.address)).to.eq(amountToken1.sub(amountOut))
      expect(await weth.balanceOf(uniWethPair.address)).to.eq(amountToken0.add(defaultAmountIn))
    })

    it('swap ETH/ERC20 DXswap', async () => {
      // get addresses of sorted pair tokens
      const token0Address = await wethPair.token0()
      const token0 = weth.address === token0Address ? weth : wethPartner
      const token1 = weth.address === token0Address ? wethPartner : weth

      amountToken0 = expandTo18Decimals(400)
      amountToken1 = expandTo18Decimals(400)
      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(wethPair.address, amountToken0)
      await wethPartner.transfer(wethPair.address, amountToken1)
      await wethPair.mint(dxdao.address)

      await expect(
        dxTrade.createSwapOrder(
          AddressZero,
          wethPartner.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address,
          { ...overrides, value: defaultAmountIn }
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await mineBlock(provider, startTime + 10)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxTrade.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      const fee = await wethPair.swapFee()
      const amountOut = await dxswapRouter.getAmountOut(defaultAmountIn, amountToken0, amountToken1, fee)
      initBalanceTokenIn = await provider.getBalance(dxTrade.address)
      initBalanceTokenOut = await wethPartner.balanceOf(dxTrade.address);

      await expect(dxTrade.executeOrder(0, overrides))
        .to.emit(dxTrade, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Sync')
        .withArgs(await token0.balanceOf(wethPair.address), await token1.balanceOf(wethPair.address))

      // dxTrade contract balance
      expect(await wethPartner.balanceOf(dxTrade.address)).to.eq(initBalanceTokenOut.add(amountOut))
      expect(await provider.getBalance(dxTrade.address)).to.eq(initBalanceTokenIn.sub(defaultAmountIn))

      // pool balance
      expect(await wethPartner.balanceOf(wethPair.address)).to.eq(amountToken1.sub(amountOut))
      expect(await weth.balanceOf(wethPair.address)).to.eq(amountToken0.add(defaultAmountIn))
    })

    it('swap ERC20/ERC20 LP address invalid', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(800) })
      await weth.transfer(wethPair.address, expandTo18Decimals(400))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(400))


      await expect(
        dxTrade.createSwapOrder(
          AddressZero,
          token2.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address,
          { ...overrides, value: defaultAmountIn }
        )
      )
        .to.be.revertedWith('DXswapRelayer: INVALID_PAIR_ADDRESS')
    })
  })

  describe('Oracle price calculation', () => {
    it('reverts oracle update if minReserve is not reached', async () => {
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await expect(dxTrade.updateOracle(0)).to.be.revertedWith('DXswapRelayer: RESERVE_TOO_LOW')
    })

    it('updates price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await dxTrade.updateOracle(0)
      await expect(dxTrade.updateOracle(0)).to.be.revertedWith('OracleCreator: PERIOD_NOT_ELAPSED')
      await mineBlock(provider, startTime + 350)
      await dxTrade.updateOracle(0)
    })

    it('consumes expected gas amount to update the price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      let tx = await dxTrade.updateOracle(0)
      let receipt = await provider.getTransactionReceipt(tx.hash)
      expect(receipt.gasUsed).to.eq(ethers.BigNumber.from(GAS_ORACLE_UPDATE))
    })
  })

  describe('Ownership and deadlines', () => {
    it('withdraws an order after expiration', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      const startBalance0 = await token0.balanceOf(owner)
      const startBalance1 = await token1.balanceOf(owner)

      await expect(
        dxTrade.createSwapOrder(
          token0.address,
          token1.address,
          defaultAmountIn,
          defaultAmountOutZero,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxTrade, 'NewOrder')
        .withArgs(0)

      await mineBlock(provider, startTime + 10)
      await dxTrade.updateOracle(0)
      await expect(dxTrade.withdrawExpiredOrder(0)).to.be.revertedWith('DXswapRelayer: DEADLINE_NOT_REACHED')
      await mineBlock(provider, defaultDeadline + 500)
      await dxTrade.withdrawExpiredOrder(0)
      expect(await token0.balanceOf(owner)).to.eq(startBalance0.add(defaultAmountIn))
      expect(await token1.balanceOf(owner)).to.eq(startBalance1.add(defaultAmountOutZero))
    })

    it('should let the owner transfer ownership', async () => {
      const oldOwner = await dxTrade.owner()
      const newOwner = token0.address
      await expect(dxTrade.transferOwnership(newOwner))
        .to.emit(dxTrade, 'OwnershipTransferred')
        .withArgs(oldOwner, newOwner)
      expect(await dxTrade.owner()).to.be.equal(newOwner)
    })
  })
})
