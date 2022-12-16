import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { constants, utils, BigNumber } from 'ethers'
import { ethers } from "hardhat";
import { Address } from 'hardhat-deploy/dist/types'
import { dxswapFixture } from './shared/fixtures'
import { expandTo18Decimals, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { DXswapFactory, DXswapPair, DXswapRelayer, DXswapRouter, ERC20Mintable, OracleCreator, WETH9 } from './../typechain'


const { AddressZero } = constants

const overrides = {
  gasLimit: 14999999
}

describe('DXswapRelayer', () => {
  let token0: ERC20Mintable
  let token1: ERC20Mintable
  let weth: WETH9
  let wethPartner: ERC20Mintable
  let wethPair: DXswapPair
  let dxswapPair: DXswapPair
  let dxswapFactory: DXswapFactory
  let dxswapRouter: DXswapRouter
  let uniPair: DXswapPair
  let uniFactory: DXswapFactory
  let oracleCreator: OracleCreator
  let dxRelayer: DXswapRelayer
  let owner: Address

  let wallet: SignerWithAddress
  let wallet2: SignerWithAddress

  async function addLiquidity(amount0: BigNumber = defaultAmountA, amount1: BigNumber = defaultAmountB) {
    if (!amount0.isZero()) await token0.transfer(dxswapPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(dxswapPair.address, amount1)
    await dxswapPair.mint(dxRelayer.address, overrides)
  }

  const defaultAmountA = expandTo18Decimals(1)
  const defaultAmountB = expandTo18Decimals(4)
  const expectedLiquidity = expandTo18Decimals(2)
  const defaultPriceTolerance = 10000 // 1%
  const defaultMinReserve = expandTo18Decimals(2)
  const defaultMaxWindowTime = 300 // 5 Minutes

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
    wallet = signers[0]
    wallet2 = signers[1]
  })

  beforeEach('deploy fixture', async function () {
    const fixture = await dxswapFixture(wallet)
    token0 = fixture.token0
    token1 = fixture.token1
    weth = fixture.WETH
    dxswapPair = fixture.dxswapPair
    wethPair = fixture.WETHPair
    wethPartner = fixture.WETHPartner
    dxswapFactory = fixture.dxswapFactory
    dxswapRouter = fixture.dxswapRouter
    uniPair = fixture.uniPair
    uniFactory = fixture.uniFactory
    oracleCreator = fixture.oracleCreator
    dxRelayer = fixture.dxRelayer
  })

  beforeEach('fund the relayer contract to spend ERC20s and ETH', async () => {
    await token0.transfer(dxRelayer.address, expandTo18Decimals(999))
    await token1.transfer(dxRelayer.address, expandTo18Decimals(999))
    await wethPartner.transfer(dxRelayer.address, expandTo18Decimals(999))
    await wallet.sendTransaction({
      to: dxRelayer.address,
      value: utils.parseEther('9')
    })
    owner = await dxRelayer.owner()
  })

  beforeEach('set timestamp', async () => {
    const lastTime = (await provider.getBlock("latest")).timestamp;
    startTime = lastTime;
    defaultDeadline = startTime + 86400
  })


  describe('Liquidity provision', () => {
    it('INIT_CODE_PAIR_HASH', async () => {
      expect(await dxswapFactory.INIT_CODE_PAIR_HASH()).to.eq('0xc30284a6e09f4f63686442b7046014b946fdb3e6c00d48b549eda87070a98167')
    })

    it('requires correct order input', async () => {
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
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
        dxRelayerFromWallet2.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: CALLER_NOT_OWNER')

      await expect(
        dxRelayer.orderLiquidityProvision(
          token1.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_PAIR')

      await expect(
        dxRelayer.orderLiquidityProvision(
          token1.address,
          token0.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_AMOUNT')

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOLERANCE')

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          1577836800,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: DEADLINE_REACHED')
    })

    it('provides initial liquidity immediately with ERC20/ERC20 pair', async () => {
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(AddressZero, dxRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(dxswapPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(dxswapPair, 'Mint')
        .withArgs(dxswapRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity with ERC20/ERC20 pair after Uniswap price observation', async () => {
      await token0.transfer(uniPair.address, expandTo18Decimals(10))
      await token1.transfer(uniPair.address, expandTo18Decimals(40))
      await uniPair.mint(wallet.address, overrides)

      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(AddressZero, dxRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(dxswapPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(dxswapPair, 'Mint')
        .withArgs(dxswapRouter.address, defaultAmountA, defaultAmountB)

      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity immediately with ETH/ERC20 pair', async () => {
      await expect(
        dxRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, dxRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB, defaultAmountA)
        .to.emit(wethPair, 'Mint')
        .withArgs(dxswapRouter.address, defaultAmountB, defaultAmountA)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await wethPair.balanceOf(dxRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(AddressZero, dxRelayer.address, expectedLiquidity)
        .to.emit(dxswapPair, 'Sync')
        .withArgs(defaultAmountA.add(expandTo18Decimals(10)), defaultAmountB.add(expandTo18Decimals(40)))
        .to.emit(dxswapPair, 'Mint')
        .withArgs(dxswapRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(expandTo18Decimals(22).sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))
      await wethPair.mint(wallet.address)
      const liquidityBalance = await wethPair.balanceOf(dxRelayer.address)

      await expect(
        dxRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, dxRelayer.address, expectedLiquidity)
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB.add(expandTo18Decimals(40)), defaultAmountA.add(expandTo18Decimals(10)))
        .to.emit(wethPair, 'Mint')
        .withArgs(dxswapRouter.address, defaultAmountB, defaultAmountA)

      expect(await wethPair.balanceOf(dxRelayer.address)).to.eq(expectedLiquidity.add(liquidityBalance))
    })

    it('withdraws an order after expiration', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      const startBalance0 = await token0.balanceOf(owner)
      const startBalance1 = await token1.balanceOf(owner)

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await dxRelayer.updateOracle(0)
      await expect(dxRelayer.withdrawExpiredOrder(0)).to.be.revertedWith('DXswapRelayer: DEADLINE_NOT_REACHED')
      await mineBlock(provider, defaultDeadline + 500)
      await dxRelayer.withdrawExpiredOrder(0)
      expect(await token0.balanceOf(owner)).to.eq(startBalance0.add(defaultAmountA))
      expect(await token1.balanceOf(owner)).to.eq(startBalance1.add(defaultAmountB))
    })
  })

  describe('Liquidity removal', () => {
    it('requires correct order input', async () => {
      const liquidityAmount = expandTo18Decimals(1)

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
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
        dxRelayerFromWallet2.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: CALLER_NOT_OWNER')

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token1.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_PAIR')

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token1.address,
          token0.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_LIQUIDITY_AMOUNT')

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: INVALID_TOLERANCE')

      await expect(
        dxRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          startTime - 1200,
          dxswapFactory.address
        )
      ).to.be.revertedWith('DXswapRelayer: DEADLINE_REACHED')
    })

    it('removes liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(2), expandTo18Decimals(8))
      await mineBlock(provider, startTime + 20)
      await expect(
        dxRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 2)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(expandTo18Decimals(4).sub(MINIMUM_LIQUIDITY))

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(dxRelayer.address, dxswapPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(dxswapPair, 'Transfer')
        .withArgs(dxswapPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(token0, 'Transfer')
        .withArgs(dxswapPair.address, dxRelayer.address, expandTo18Decimals(1).sub(500))
        .to.emit(token1, 'Transfer')
        .withArgs(dxswapPair.address, dxRelayer.address, expandTo18Decimals(4).sub(2000))
        .to.emit(dxswapPair, 'Sync')
        .withArgs(expandTo18Decimals(1).add(500), expandTo18Decimals(4).add(2000))
        .to.emit(dxswapPair, 'Burn')
        .withArgs(
          dxswapRouter.address,
          expandTo18Decimals(1).sub(500),
          expandTo18Decimals(4).sub(2000),
          dxRelayer.address
        )

      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(expandTo18Decimals(2))
    })

    it('removes liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))

      await wethPair.mint(dxRelayer.address)
      await mineBlock(provider, startTime + 100)

      await expect(
        dxRelayer.orderLiquidityRemoval(
          AddressZero,
          wethPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 2)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      expect(await wethPair.balanceOf(dxRelayer.address)).to.eq(expandTo18Decimals(20).sub(MINIMUM_LIQUIDITY))

      const wethAmount = expandTo18Decimals(1).sub(500)
      const wethPartnerAmount = expandTo18Decimals(4).sub(2000)

      await expect(dxRelayer.executeOrder(0))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(dxRelayer.address, wethPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Transfer')
        .withArgs(wethPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wethPair.address, dxRelayer.address, wethPartnerAmount)
        .to.emit(weth, 'Transfer')
        .withArgs(wethPair.address, dxRelayer.address, wethAmount)
        .to.emit(wethPair, 'Sync')
        .withArgs( 
          weth.address === await wethPair.token0() ? expandTo18Decimals(9).add(500) :  expandTo18Decimals(36).add(2000),
          wethPartner.address === await wethPair.token1() ?  expandTo18Decimals(36).add(2000) : expandTo18Decimals(9).add(500)
        )
        .to.emit(wethPair, 'Burn')
        .withArgs(
          dxswapRouter.address,
          weth.address === await wethPair.token0() ? wethAmount : wethPartnerAmount,
          wethPartner.address === await wethPair.token1() ? wethPartnerAmount : wethAmount,
          dxRelayer.address
        )

      expect(await wethPair.balanceOf(dxRelayer.address)).to.eq(expandTo18Decimals(18))
    })
  })

  describe('Oracle price calculation', () => {
    it('reverts oracle update if minReserve is not reached', async () => {
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await expect(dxRelayer.updateOracle(0)).to.be.revertedWith('DXswapRelayer: RESERVE_TO_LOW')
    })

    it('updates price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dxRelayer.updateOracle(0)
      await expect(dxRelayer.updateOracle(0)).to.be.revertedWith('OracleCreator: PERIOD_NOT_ELAPSED')
      await mineBlock(provider, startTime + 350)
      await dxRelayer.updateOracle(0)
    })

    it('consumes 179154 gas to update the price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          dxswapFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      let tx = await dxRelayer.updateOracle(0)
      let receipt = await provider.getTransactionReceipt(tx.hash)
      expect(receipt.gasUsed).to.eq(ethers.BigNumber.from('179154'))
    })

    it('reverts if token amount is insufficient based on uniswap price', async () => {
      let timestamp = startTime

      /* DXswap price of 1:4 */
      await token0.transfer(dxswapPair.address, expandTo18Decimals(100))
      await token1.transfer(dxswapPair.address, expandTo18Decimals(400))
      await dxswapPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      /* Uniswap starting price of 1:2 */
      await token0.transfer(uniPair.address, expandTo18Decimals(100))
      await token1.transfer(uniPair.address, expandTo18Decimals(200))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          expandTo18Decimals(10),
          expandTo18Decimals(40),
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, (timestamp += 30))

      // Uniswap move price ratio to 1:5
      await token0.transfer(uniPair.address, expandTo18Decimals(200))
      await token1.transfer(uniPair.address, expandTo18Decimals(1300))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 150))
      await dxRelayer.updateOracle(0)

      // Uniswap price should be more than four and less than five
      expect(await oracleCreator.consult(0, token0.address, 100, overrides)).to.eq(448)

      await expect(dxRelayer.executeOrder(0, overrides))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.be.revertedWith('DXswapRouter: INSUFFICIENT_B_AMOUNT')
    })

    it('provides the liquidity with the correct price based on uniswap price', async () => {
      let timestamp = startTime
      const token0AmountLP = expandTo18Decimals(10)
      const token1AmountLP = expandTo18Decimals(36)

      /* DXswap price of 1:4 */
      await token0.transfer(dxswapPair.address, expandTo18Decimals(100))
      await token1.transfer(dxswapPair.address, expandTo18Decimals(400))
      await dxswapPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      /* Uniswap starting price of 1:2 */
      await token0.transfer(uniPair.address, expandTo18Decimals(100))
      await token1.transfer(uniPair.address, expandTo18Decimals(200))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      await expect(
        dxRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          token0AmountLP,
          token1AmountLP,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dxRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dxRelayer.updateOracle(0)
      await mineBlock(provider, (timestamp += 30))

      // Uniswap move price ratio to 1:5
      await token0.transfer(uniPair.address, expandTo18Decimals(200))
      await token1.transfer(uniPair.address, expandTo18Decimals(1300))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 150))
      await dxRelayer.updateOracle(0)

      // Uniswap price should be more than four and less than five
      expect(await oracleCreator.consult(0, token0.address, 100, overrides)).to.eq(448)

      await expect(dxRelayer.executeOrder(0, overrides))
        .to.emit(dxRelayer, 'ExecutedOrder')
        .withArgs(0)

      // Uniswap price is the same
      expect(await oracleCreator.consult(0, token0.address, 100, overrides)).to.eq(448)
      expect(await dxswapPair.balanceOf(dxRelayer.address)).to.eq(ethers.BigNumber.from(('18000000000000000000')))
    })

    it('should let the owner transfer ownership', async () => {
      const oldOwner = await dxRelayer.owner()
      const newOwner = token0.address
      await expect(dxRelayer.transferOwnership(newOwner))
        .to.emit(dxRelayer, 'OwnershipTransferred')
        .withArgs(oldOwner, newOwner)
      expect(await dxRelayer.owner()).to.be.equal(newOwner)
    })
  })
})
