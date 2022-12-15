import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers, network } from "hardhat";
import { constants, BigNumber, Wallet } from 'ethers'
import { ecsign } from 'ethereumjs-util'
import { dxswapFixture } from './shared/fixtures'
import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { DeflatingERC20, DeflatingERC20__factory, DXswapFactory, DXswapPair, DXswapRouter, ERC20Mintable, RouterEventEmitter, WETH9 } from './../typechain'

const { AddressZero, Zero, MaxUint256 } = constants

const overrides = {
  gasLimit: 9999999
}

describe('DXswapRouter', () => {
  const provider = ethers.provider

  // tokens
  let token0: ERC20Mintable
  let token1: ERC20Mintable
  let token2: ERC20Mintable
  let weth: WETH9
  let wethPartner: ERC20Mintable
  let DTT: DeflatingERC20
  //pairs
  let wethPair: DXswapPair
  let uniWethPair: DXswapPair
  let dxswapPair: DXswapPair
  let wethDttPair: DXswapPair
  // contracts
  let dxswapFactory: DXswapFactory
  let uniFactory: DXswapFactory
  let dxswapRouter: DXswapRouter
  let routerEventEmitter: RouterEventEmitter

  // wallets
  let wallet: SignerWithAddress

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    wallet = signers[0]
  })

  beforeEach('deploy fixture', async function () {
    const fixture = await dxswapFixture(wallet)
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
    uniFactory = fixture.uniFactory
    routerEventEmitter = fixture.routerEventEmitter
  })

  afterEach(async function () {
    expect(await provider.getBalance(dxswapRouter.address)).to.eq(Zero)
  })

  it('factory, weth', async () => {
    expect(await dxswapFactory.INIT_CODE_PAIR_HASH()).to.eq('0xc30284a6e09f4f63686442b7046014b946fdb3e6c00d48b549eda87070a98167')
    expect(await dxswapRouter.factory()).to.eq(dxswapFactory.address)
    expect(await dxswapRouter.WETH()).to.eq(weth.address)
  })

  it('addLiquidity', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)

    const expectedLiquidity = expandTo18Decimals(2)
    await token0.approve(dxswapRouter.address, MaxUint256)
    await token1.approve(dxswapRouter.address, MaxUint256)
    await expect(
      dxswapRouter.addLiquidity(
        token0.address,
        token1.address,
        token0Amount,
        token1Amount,
        0,
        0,
        wallet.address,
        MaxUint256,
        overrides
      )
    )
      .to.emit(token0, 'Transfer')
      .withArgs(wallet.address, dxswapPair.address, token0Amount)
      .to.emit(token1, 'Transfer')
      .withArgs(wallet.address, dxswapPair.address, token1Amount)
      .to.emit(dxswapPair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(dxswapPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(dxswapPair, 'Sync')
      .withArgs(token0Amount, token1Amount)
      .to.emit(dxswapPair, 'Mint')
      .withArgs(dxswapRouter.address, token0Amount, token1Amount)

    expect(await dxswapPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })

  it('addLiquidityETH', async () => {
    const WETHPartnerAmount = expandTo18Decimals(1)
    const ETHAmount = expandTo18Decimals(4)

    const expectedLiquidity = expandTo18Decimals(2)
    const WETHPairToken0 = await wethPair.token0()
    await wethPartner.approve(dxswapRouter.address, MaxUint256)
    await expect(
      dxswapRouter.addLiquidityETH(
        wethPartner.address,
        WETHPartnerAmount,
        WETHPartnerAmount,
        ETHAmount,
        wallet.address,
        MaxUint256,
        { ...overrides, value: ETHAmount }
      )
    )
      .to.emit(wethPair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(wethPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(wethPair, 'Sync')
      .withArgs(
        WETHPairToken0 === wethPartner.address ? WETHPartnerAmount : ETHAmount,
        WETHPairToken0 === wethPartner.address ? ETHAmount : WETHPartnerAmount
      )
      .to.emit(wethPair, 'Mint')
      .withArgs(
        dxswapRouter.address,
        WETHPairToken0 === wethPartner.address ? WETHPartnerAmount : ETHAmount,
        WETHPairToken0 === wethPartner.address ? ETHAmount : WETHPartnerAmount
      )

    expect(await wethPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(dxswapPair.address, token0Amount)
    await token1.transfer(dxswapPair.address, token1Amount)
    await dxswapPair.mint(wallet.address, overrides)
  }
  it('removeLiquidity', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await addLiquidity(token0Amount, token1Amount)

    const expectedLiquidity = expandTo18Decimals(2)
    await dxswapPair.approve(dxswapRouter.address, MaxUint256)
    await expect(
      dxswapRouter.removeLiquidity(
        token0.address,
        token1.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        wallet.address,
        MaxUint256,
        overrides
      )
    )
      .to.emit(dxswapPair, 'Transfer')
      .withArgs(wallet.address, dxswapPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(dxswapPair, 'Transfer')
      .withArgs(dxswapPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(token0, 'Transfer')
      .withArgs(dxswapPair.address, wallet.address, token0Amount.sub(500))
      .to.emit(token1, 'Transfer')
      .withArgs(dxswapPair.address, wallet.address, token1Amount.sub(2000))
      .to.emit(dxswapPair, 'Sync')
      .withArgs(500, 2000)
      .to.emit(dxswapPair, 'Burn')
      .withArgs(dxswapRouter.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

    expect(await dxswapPair.balanceOf(wallet.address)).to.eq(0)
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
  })

  it('removeLiquidityETH', async () => {
    const WETHPartnerAmount = expandTo18Decimals(1)
    const ETHAmount = expandTo18Decimals(4)
    await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
    await weth.deposit({ value: ETHAmount })
    await weth.transfer(wethPair.address, ETHAmount)
    await wethPair.mint(wallet.address, overrides)

    const expectedLiquidity = expandTo18Decimals(2)
    const WETHPairToken0 = await wethPair.token0()
    await wethPair.approve(dxswapRouter.address, MaxUint256)
    await expect(
      dxswapRouter.removeLiquidityETH(
        wethPartner.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        wallet.address,
        MaxUint256,
        overrides
      )
    )
      .to.emit(wethPair, 'Transfer')
      .withArgs(wallet.address, wethPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(wethPair, 'Transfer')
      .withArgs(wethPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(weth, 'Transfer')
      .withArgs(wethPair.address, dxswapRouter.address, ETHAmount.sub(2000))
      .to.emit(wethPartner, 'Transfer')
      .withArgs(wethPair.address, dxswapRouter.address, WETHPartnerAmount.sub(500))
      .to.emit(wethPartner, 'Transfer')
      .withArgs(dxswapRouter.address, wallet.address, WETHPartnerAmount.sub(500))
      .to.emit(wethPair, 'Sync')
      .withArgs(
        WETHPairToken0 === wethPartner.address ? 500 : 2000,
        WETHPairToken0 === wethPartner.address ? 2000 : 500
      )
      .to.emit(wethPair, 'Burn')
      .withArgs(
        dxswapRouter.address,
        WETHPairToken0 === wethPartner.address ? WETHPartnerAmount.sub(500) : ETHAmount.sub(2000),
        WETHPairToken0 === wethPartner.address ? ETHAmount.sub(2000) : WETHPartnerAmount.sub(500),
        dxswapRouter.address
      )

    expect(await wethPair.balanceOf(wallet.address)).to.eq(0)
    const totalSupplyWETHPartner = await wethPartner.totalSupply()
    const totalSupplyWETH = await weth.totalSupply()
    expect(await wethPartner.balanceOf(wallet.address)).to.eq(totalSupplyWETHPartner.sub(500))
    expect(await weth.balanceOf(wallet.address)).to.eq(totalSupplyWETH.sub(2000))
  })

  describe('removeWithPermit', () => {
    let privateKey: string
    let customWallet: Wallet
    let customSigner: SignerWithAddress

    // create random wallet to get private key used to generate signature
    beforeEach('set custom wallet', async function () {
      customWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      privateKey = customWallet.privateKey

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [customWallet.address]
      })

      customSigner = await ethers.getSigner(customWallet.address)

      await wallet.sendTransaction({
        value: expandTo18Decimals(100),
        to: customSigner.address,
      });
    })

    beforeEach('deploy fixture', async function () {
      const fixture = await dxswapFixture(customSigner)
      token0 = fixture.token0
      token1 = fixture.token1
      weth = fixture.WETH
      wethPartner = fixture.WETHPartner
      wethPair = fixture.WETHPair
      dxswapPair = fixture.dxswapPair
      dxswapRouter = fixture.dxswapRouter
      DTT = fixture.DTT
      wethDttPair = fixture.WETHDTTPair
    })

    it('removeLiquidityWithPermit', async () => {
      const token0Amount = expandTo18Decimals(1)
      const token1Amount = expandTo18Decimals(4)

      await token0.transfer(dxswapPair.address, token0Amount)
      await token1.transfer(dxswapPair.address, token1Amount)
      await dxswapPair.mint(customSigner.address, overrides)

      const expectedLiquidity = expandTo18Decimals(2)

      const nonce = await dxswapPair.nonces(customSigner.address)
      const digest = await getApprovalDigest(
        dxswapPair,
        { owner: customSigner.address, spender: dxswapRouter.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
        nonce,
        MaxUint256
      )
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))

      await dxswapRouter.removeLiquidityWithPermit(
        token0.address,
        token1.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        customSigner.address,
        MaxUint256,
        false,
        v,
        r,
        s,
        overrides
      )
    })

    it('removeLiquidityETHWithPermit', async () => {
      const WETHPartnerAmount = expandTo18Decimals(1)
      const ETHAmount = expandTo18Decimals(4)
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(customSigner.address, overrides)

      const expectedLiquidity = expandTo18Decimals(2)

      const nonce = await wethPair.nonces(wallet.address)
      const digest = await getApprovalDigest(
        wethPair,
        { owner: customSigner.address, spender: dxswapRouter.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
        nonce,
        MaxUint256
      )

      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))

      await dxswapRouter.removeLiquidityETHWithPermit(
        wethPartner.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        customSigner.address,
        MaxUint256,
        false,
        v,
        r,
        s,
        overrides
      )
    })

    it('removeLiquidityETHWithPermitSupportingFeeOnTransferTokens', async () => {
      const DTTAmount = expandTo18Decimals(1)
        .mul(100)
        .div(99)
      const ETHAmount = expandTo18Decimals(4)

      await DTT.transfer(wethDttPair.address, DTTAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethDttPair.address, ETHAmount)
      await wethDttPair.mint(customSigner.address, overrides)

      const expectedLiquidity = expandTo18Decimals(2)

      const nonce = await dxswapPair.nonces(customSigner.address)
      const digest = await getApprovalDigest(
        wethDttPair,
        { owner: customSigner.address, spender: dxswapRouter.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
        nonce,
        MaxUint256
      )
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))

      const DTTInPair = await DTT.balanceOf(wethDttPair.address)
      const WETHInPair = await weth.balanceOf(wethDttPair.address)
      const liquidity = await wethDttPair.balanceOf(customSigner.address)
      const totalSupply = await wethDttPair.totalSupply()
      const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply)
      const WETHExpected = WETHInPair.mul(liquidity).div(totalSupply)

      await wethDttPair.approve(dxswapRouter.address, MaxUint256)
      await dxswapRouter.removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        DTT.address,
        liquidity,
        NaiveDTTExpected,
        WETHExpected,
        customSigner.address,
        MaxUint256,
        false,
        v,
        r,
        s,
        overrides
      )
    })
  })

  describe('swapExactTokensForTokens', () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = ethers.BigNumber.from('1663192997082117548')

    beforeEach(async () => {
      await addLiquidity(token0Amount, token1Amount)
      await token0.approve(dxswapRouter.address, MaxUint256)
    })

    it('happy path', async () => {
      await expect(
        dxswapRouter.swapExactTokensForTokens(
          swapAmount,
          0,
          [token0.address, token1.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(token0, 'Transfer')
        .withArgs(wallet.address, dxswapPair.address, swapAmount)
        .to.emit(token1, 'Transfer')
        .withArgs(dxswapPair.address, wallet.address, expectedOutputAmount)
        .to.emit(dxswapPair, 'Sync')
        .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
    })

    it('amounts', async () => {
      await token0.approve(routerEventEmitter.address, MaxUint256)
      await expect(
        routerEventEmitter.swapExactTokensForTokens(
          dxswapRouter.address,
          swapAmount,
          0,
          [token0.address, token1.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([swapAmount, expectedOutputAmount])
    })

    it('gas', async () => {
      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await dxswapPair.sync(overrides)

      await token0.approve(dxswapRouter.address, MaxUint256)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      const tx = await dxswapRouter.swapExactTokensForTokens(
        swapAmount,
        0,
        [token0.address, token1.address],
        wallet.address,
        MaxUint256,
        overrides
      )
      const receipt = await tx.wait()
      expect(receipt.gasUsed).to.eq(103507)
    }).retries(3)
  })

  describe('swapTokensForExactTokens', () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    const expectedSwapAmount = ethers.BigNumber.from('556947925368978001')
    const outputAmount = expandTo18Decimals(1)

    beforeEach(async () => {
      await addLiquidity(token0Amount, token1Amount)
    })

    it('happy path', async () => {
      await token0.approve(dxswapRouter.address, MaxUint256)
      await expect(
        dxswapRouter.swapTokensForExactTokens(
          outputAmount,
          MaxUint256,
          [token0.address, token1.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(token0, 'Transfer')
        .withArgs(wallet.address, dxswapPair.address, expectedSwapAmount)
        .to.emit(token1, 'Transfer')
        .withArgs(dxswapPair.address, wallet.address, outputAmount)
        .to.emit(dxswapPair, 'Sync')
        .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
        .to.emit(dxswapPair, 'Swap')
        .withArgs(dxswapRouter.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
    })

    it('amounts', async () => {
      await token0.approve(routerEventEmitter.address, MaxUint256)
      await expect(
        routerEventEmitter.swapTokensForExactTokens(
          dxswapRouter.address,
          outputAmount,
          MaxUint256,
          [token0.address, token1.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([expectedSwapAmount, outputAmount])
    })
  })

  describe('swapExactETHForTokens', () => {
    const WETHPartnerAmount = expandTo18Decimals(10)
    const ETHAmount = expandTo18Decimals(5)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = ethers.BigNumber.from('1663192997082117548')

    beforeEach(async () => {
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(wallet.address, overrides)

      await token0.approve(dxswapRouter.address, MaxUint256)
    })

    it('happy path', async () => {
      const WETHPairToken0 = await wethPair.token0()
      await expect(
        dxswapRouter.swapExactETHForTokens(0, [weth.address, wethPartner.address], wallet.address, MaxUint256, {
          ...overrides,
          value: swapAmount
        })
      )
        .to.emit(weth, 'Transfer')
        .withArgs(dxswapRouter.address, wethPair.address, swapAmount)
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wethPair.address, wallet.address, expectedOutputAmount)
        .to.emit(wethPair, 'Sync')
        .withArgs(
          WETHPairToken0 === wethPartner.address
            ? WETHPartnerAmount.sub(expectedOutputAmount)
            : ETHAmount.add(swapAmount),
          WETHPairToken0 === wethPartner.address
            ? ETHAmount.add(swapAmount)
            : WETHPartnerAmount.sub(expectedOutputAmount)
        )
        .to.emit(wethPair, 'Swap')
        .withArgs(
          dxswapRouter.address,
          WETHPairToken0 === wethPartner.address ? 0 : swapAmount,
          WETHPairToken0 === wethPartner.address ? swapAmount : 0,
          WETHPairToken0 === wethPartner.address ? expectedOutputAmount : 0,
          WETHPairToken0 === wethPartner.address ? 0 : expectedOutputAmount,
          wallet.address
        )
    })

    it('amounts', async () => {
      await expect(
        routerEventEmitter.swapExactETHForTokens(
          dxswapRouter.address,
          0,
          [weth.address, wethPartner.address],
          wallet.address,
          MaxUint256,
          {
            ...overrides,
            value: swapAmount
          }
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([swapAmount, expectedOutputAmount])
    })

    it('gas', async () => {
      const WETHPartnerAmount = expandTo18Decimals(10)
      const ETHAmount = expandTo18Decimals(5)
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(wallet.address, overrides)

      // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await dxswapPair.sync(overrides)

      const swapAmount = expandTo18Decimals(1)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      const tx = await dxswapRouter.swapExactETHForTokens(
        0,
        [weth.address, wethPartner.address],
        wallet.address,
        MaxUint256,
        {
          ...overrides,
          value: swapAmount
        }
      )
      const receipt = await tx.wait()
      expect(receipt.gasUsed).to.eq(106726)
    }).retries(3)
  })

  describe('swapTokensForExactETH', () => {
    const WETHPartnerAmount = expandTo18Decimals(5)
    const ETHAmount = expandTo18Decimals(10)
    const expectedSwapAmount = ethers.BigNumber.from('556947925368978001')
    const outputAmount = expandTo18Decimals(1)

    beforeEach(async () => {
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(wallet.address, overrides)
    })

    it('happy path', async () => {
      await wethPartner.approve(dxswapRouter.address, MaxUint256)
      const WETHPairToken0 = await wethPair.token0()
      await expect(
        dxswapRouter.swapTokensForExactETH(
          outputAmount,
          MaxUint256,
          [wethPartner.address, weth.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wallet.address, wethPair.address, expectedSwapAmount)
        .to.emit(weth, 'Transfer')
        .withArgs(wethPair.address, dxswapRouter.address, outputAmount)
        .to.emit(wethPair, 'Sync')
        .withArgs(
          WETHPairToken0 === wethPartner.address
            ? WETHPartnerAmount.add(expectedSwapAmount)
            : ETHAmount.sub(outputAmount),
          WETHPairToken0 === wethPartner.address
            ? ETHAmount.sub(outputAmount)
            : WETHPartnerAmount.add(expectedSwapAmount)
        )
        .to.emit(wethPair, 'Swap')
        .withArgs(
          dxswapRouter.address,
          WETHPairToken0 === wethPartner.address ? expectedSwapAmount : 0,
          WETHPairToken0 === wethPartner.address ? 0 : expectedSwapAmount,
          WETHPairToken0 === wethPartner.address ? 0 : outputAmount,
          WETHPairToken0 === wethPartner.address ? outputAmount : 0,
          dxswapRouter.address
        )
    })

    it('amounts', async () => {
      await wethPartner.approve(routerEventEmitter.address, MaxUint256)
      await expect(
        routerEventEmitter.swapTokensForExactETH(
          dxswapRouter.address,
          outputAmount,
          MaxUint256,
          [wethPartner.address, weth.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([expectedSwapAmount, outputAmount])
    })
  })

  describe('swapExactTokensForETH', () => {
    const WETHPartnerAmount = expandTo18Decimals(5)
    const ETHAmount = expandTo18Decimals(10)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = ethers.BigNumber.from('1663192997082117548')

    beforeEach(async () => {
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(wallet.address, overrides)
    })

    it('happy path', async () => {
      await wethPartner.approve(dxswapRouter.address, MaxUint256)
      const WETHPairToken0 = await wethPair.token0()
      await expect(
        dxswapRouter.swapExactTokensForETH(
          swapAmount,
          0,
          [wethPartner.address, weth.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wallet.address, wethPair.address, swapAmount)
        .to.emit(weth, 'Transfer')
        .withArgs(wethPair.address, dxswapRouter.address, expectedOutputAmount)
        .to.emit(wethPair, 'Sync')
        .withArgs(
          WETHPairToken0 === wethPartner.address
            ? WETHPartnerAmount.add(swapAmount)
            : ETHAmount.sub(expectedOutputAmount),
          WETHPairToken0 === wethPartner.address
            ? ETHAmount.sub(expectedOutputAmount)
            : WETHPartnerAmount.add(swapAmount)
        )
        .to.emit(wethPair, 'Swap')
        .withArgs(
          dxswapRouter.address,
          WETHPairToken0 === wethPartner.address ? swapAmount : 0,
          WETHPairToken0 === wethPartner.address ? 0 : swapAmount,
          WETHPairToken0 === wethPartner.address ? 0 : expectedOutputAmount,
          WETHPairToken0 === wethPartner.address ? expectedOutputAmount : 0,
          dxswapRouter.address
        )
    })

    it('amounts', async () => {
      await wethPartner.approve(routerEventEmitter.address, MaxUint256)
      await expect(
        routerEventEmitter.swapExactTokensForETH(
          dxswapRouter.address,
          swapAmount,
          0,
          [wethPartner.address, weth.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([swapAmount, expectedOutputAmount])
    })
  })

  describe('swapETHForExactTokens', () => {
    const WETHPartnerAmount = expandTo18Decimals(10)
    const ETHAmount = expandTo18Decimals(5)
    const expectedSwapAmount = ethers.BigNumber.from('556947925368978001')
    const outputAmount = expandTo18Decimals(1)

    beforeEach(async () => {
      await wethPartner.transfer(wethPair.address, WETHPartnerAmount)
      await weth.deposit({ value: ETHAmount })
      await weth.transfer(wethPair.address, ETHAmount)
      await wethPair.mint(wallet.address, overrides)
    })

    it('happy path', async () => {
      const WETHPairToken0 = await wethPair.token0()
      await expect(
        dxswapRouter.swapETHForExactTokens(outputAmount, [weth.address, wethPartner.address], wallet.address, MaxUint256, {
          ...overrides,
          value: expectedSwapAmount
        })
      )
        .to.emit(weth, 'Transfer')
        .withArgs(dxswapRouter.address, wethPair.address, expectedSwapAmount)
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wethPair.address, wallet.address, outputAmount)
        .to.emit(wethPair, 'Sync')
        .withArgs(
          WETHPairToken0 === wethPartner.address
            ? WETHPartnerAmount.sub(outputAmount)
            : ETHAmount.add(expectedSwapAmount),
          WETHPairToken0 === wethPartner.address
            ? ETHAmount.add(expectedSwapAmount)
            : WETHPartnerAmount.sub(outputAmount)
        )
        .to.emit(wethPair, 'Swap')
        .withArgs(
          dxswapRouter.address,
          WETHPairToken0 === wethPartner.address ? 0 : expectedSwapAmount,
          WETHPairToken0 === wethPartner.address ? expectedSwapAmount : 0,
          WETHPairToken0 === wethPartner.address ? outputAmount : 0,
          WETHPairToken0 === wethPartner.address ? 0 : outputAmount,
          wallet.address
        )
    })

    it('amounts', async () => {
      await expect(
        routerEventEmitter.swapETHForExactTokens(
          dxswapRouter.address,
          outputAmount,
          [weth.address, wethPartner.address],
          wallet.address,
          MaxUint256,
          {
            ...overrides,
            value: expectedSwapAmount
          }
        )
      )
        .to.emit(routerEventEmitter, 'Amounts')
        .withArgs([expectedSwapAmount, outputAmount])
    })
  })

  it('quote', async () => {
    expect(await dxswapRouter.quote(ethers.BigNumber.from(1), ethers.BigNumber.from(100), ethers.BigNumber.from(200))).to.eq(ethers.BigNumber.from(2))
    expect(await dxswapRouter.quote(ethers.BigNumber.from(2), ethers.BigNumber.from(200), ethers.BigNumber.from(100))).to.eq(ethers.BigNumber.from(1))
    await expect(dxswapRouter.quote(ethers.BigNumber.from(0), ethers.BigNumber.from(100), ethers.BigNumber.from(200))).to.be.revertedWith(
      'DXswapLibrary: INSUFFICIENT_AMOUNT'
    )
    await expect(dxswapRouter.quote(ethers.BigNumber.from(1), ethers.BigNumber.from(0), ethers.BigNumber.from(200))).to.be.revertedWith(
      'DXswapLibrary: INSUFFICIENT_LIQUIDITY'
    )
    await expect(dxswapRouter.quote(ethers.BigNumber.from(1), ethers.BigNumber.from(100), ethers.BigNumber.from(0))).to.be.revertedWith(
      'DXswapLibrary: INSUFFICIENT_LIQUIDITY'
    )
  })

  it('getAmountOut', async () => {
    expect(await dxswapRouter.getAmountOut(ethers.BigNumber.from(2), ethers.BigNumber.from(100), ethers.BigNumber.from(100), ethers.BigNumber.from(30))).to.eq(
      ethers.BigNumber.from(1)
    )
    await expect(
      dxswapRouter.getAmountOut(ethers.BigNumber.from(0), ethers.BigNumber.from(100), ethers.BigNumber.from(100), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_INPUT_AMOUNT')
    await expect(
      dxswapRouter.getAmountOut(ethers.BigNumber.from(2), ethers.BigNumber.from(0), ethers.BigNumber.from(100), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_LIQUIDITY')
    await expect(
      dxswapRouter.getAmountOut(ethers.BigNumber.from(2), ethers.BigNumber.from(100), ethers.BigNumber.from(0), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_LIQUIDITY')
  })

  it('getAmountIn', async () => {
    expect(await dxswapRouter.getAmountIn(ethers.BigNumber.from(1), ethers.BigNumber.from(100), ethers.BigNumber.from(100), ethers.BigNumber.from(30))).to.eq(
      ethers.BigNumber.from(2)
    )
    await expect(
      dxswapRouter.getAmountIn(ethers.BigNumber.from(0), ethers.BigNumber.from(100), ethers.BigNumber.from(100), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_OUTPUT_AMOUNT')
    await expect(
      dxswapRouter.getAmountIn(ethers.BigNumber.from(1), ethers.BigNumber.from(0), ethers.BigNumber.from(100), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_LIQUIDITY')
    await expect(
      dxswapRouter.getAmountIn(ethers.BigNumber.from(1), ethers.BigNumber.from(100), ethers.BigNumber.from(0), ethers.BigNumber.from(30))
    ).to.be.revertedWith('DXswapLibrary: INSUFFICIENT_LIQUIDITY')
  })

  it('getAmountsOut', async () => {
    await token0.approve(dxswapRouter.address, MaxUint256)
    await token1.approve(dxswapRouter.address, MaxUint256)
    await dxswapRouter.addLiquidity(
      token0.address,
      token1.address,
      ethers.BigNumber.from(10000),
      ethers.BigNumber.from(10000),
      0,
      0,
      wallet.address,
      MaxUint256,
      overrides
    )

    await expect(dxswapRouter.getAmountsOut(ethers.BigNumber.from(2), [token0.address])).to.be.revertedWith(
      'DXswapLibrary: INVALID_PATH'
    )
    const path = [token0.address, token1.address]
    expect(await dxswapRouter.getAmountsOut(ethers.BigNumber.from(2), path)).to.deep.eq([ethers.BigNumber.from(2), ethers.BigNumber.from(1)])
  })

  it('getAmountsIn', async () => {
    await token0.approve(dxswapRouter.address, MaxUint256)
    await token1.approve(dxswapRouter.address, MaxUint256)
    await dxswapRouter.addLiquidity(
      token0.address,
      token1.address,
      ethers.BigNumber.from(10000),
      ethers.BigNumber.from(10000),
      0,
      0,
      wallet.address,
      MaxUint256,
      overrides
    )

    await expect(dxswapRouter.getAmountsIn(ethers.BigNumber.from(1), [token0.address])).to.be.revertedWith(
      'DXswapLibrary: INVALID_PATH'
    )
    const path = [token0.address, token1.address]
    expect(await dxswapRouter.getAmountsIn(ethers.BigNumber.from(1), path)).to.deep.eq([ethers.BigNumber.from(2), ethers.BigNumber.from(1)])
  })
})

describe('DxswapRouter: fee-on-transfer tokens', () => {
  const provider = ethers.provider

  let DTT: DeflatingERC20
  let DTT2: DeflatingERC20
  let dxswapRouter: DXswapRouter
  let dxswapPair: DXswapPair
  let weth: WETH9
  let wallet: SignerWithAddress
  let routerEventEmitter: RouterEventEmitter
  let dxswapFactory: DXswapFactory
  let WETHDTTPair: DXswapPair

  beforeEach(async function () {
    const signers = await ethers.getSigners()
    wallet = signers[0]
    const fixture = await dxswapFixture(wallet)
    dxswapRouter = fixture.dxswapRouter
    dxswapFactory = fixture.dxswapFactory
    weth = fixture.WETH
    routerEventEmitter = fixture.routerEventEmitter
    DTT = fixture.DTT
    DTT2 = fixture.DTT2
    WETHDTTPair = fixture.WETHDTTPair
    dxswapPair = fixture.dxswapPair
  })

  afterEach(async function () {
    expect(await provider.getBalance(dxswapRouter.address)).to.eq(0)
  })

  async function addLiquidity(DTTAmount: BigNumber, WETHAmount: BigNumber) {
    await DTT.approve(dxswapRouter.address, MaxUint256)
    await dxswapRouter.addLiquidityETH(DTT.address, DTTAmount, DTTAmount, WETHAmount, wallet.address, MaxUint256, {
      ...overrides,
      value: WETHAmount
    })
  }

  it('removeLiquidityETHSupportingFeeOnTransferTokens', async () => {
    const DTTAmount = expandTo18Decimals(1)
    const ETHAmount = expandTo18Decimals(4)
    await addLiquidity(DTTAmount, ETHAmount)

    const DTTInPair = await DTT.balanceOf(WETHDTTPair.address)
    const WETHInPair = await weth.balanceOf(WETHDTTPair.address)
    const liquidity = await WETHDTTPair.balanceOf(wallet.address)
    const totalSupply = await WETHDTTPair.totalSupply()
    const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply)
    const WETHExpected = WETHInPair.mul(liquidity).div(totalSupply)

    await WETHDTTPair.approve(dxswapRouter.address, MaxUint256)

    await dxswapRouter.removeLiquidityETHSupportingFeeOnTransferTokens(
      DTT.address,
      liquidity,
      NaiveDTTExpected,
      WETHExpected,
      wallet.address,
      MaxUint256,
      overrides
    )
  })

  describe('swapExactTokensForTokensSupportingFeeOnTransferTokens', () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99)
    const ETHAmount = expandTo18Decimals(10)
    const amountIn = expandTo18Decimals(1)

    beforeEach(async () => {
      await addLiquidity(DTTAmount, ETHAmount)
    })

    it('DTT -> weth', async () => {
      await DTT.approve(dxswapRouter.address, MaxUint256)

      await dxswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [DTT.address, weth.address],
        wallet.address,
        MaxUint256,
        overrides
      )
    })

    // weth -> DTT
    it('weth -> DTT', async () => {
      await weth.deposit({ value: amountIn }) // mint weth
      await weth.approve(dxswapRouter.address, MaxUint256)

      await dxswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [weth.address, DTT.address],
        wallet.address,
        MaxUint256,
        overrides
      )
    })
  })

  // ETH -> DTT
  it('swapExactETHForTokensSupportingFeeOnTransferTokens', async () => {
    const DTTAmount = expandTo18Decimals(10)
      .mul(100)
      .div(99)
    const ETHAmount = expandTo18Decimals(5)
    const swapAmount = expandTo18Decimals(1)
    await addLiquidity(DTTAmount, ETHAmount)

    await dxswapRouter.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      [weth.address, DTT.address],
      wallet.address,
      MaxUint256,
      {
        ...overrides,
        value: swapAmount
      }
    )
  })

  // DTT -> ETH
  it('swapExactTokensForETHSupportingFeeOnTransferTokens', async () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99)
    const ETHAmount = expandTo18Decimals(10)
    const swapAmount = expandTo18Decimals(1)

    await addLiquidity(DTTAmount, ETHAmount)
    await DTT.approve(dxswapRouter.address, MaxUint256)

    await dxswapRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
      swapAmount,
      0,
      [DTT.address, weth.address],
      wallet.address,
      MaxUint256,
      overrides
    )
  })
})

describe('DxswapRouter: fee-on-transfer tokens: reloaded', () => {
  const provider = ethers.provider

  let DTT: DeflatingERC20
  let DTT2: DeflatingERC20
  let dxswapRouter: DXswapRouter
  let wallet: SignerWithAddress

  beforeEach(async function () {
    const signers = await ethers.getSigners()
    wallet = signers[0]

    const fixture = await dxswapFixture(wallet)
    dxswapRouter = fixture.dxswapRouter

    const tokenTotalSupply = expandTo18Decimals(21000000)

    DTT = await new DeflatingERC20__factory(wallet).deploy(tokenTotalSupply)
    DTT2 = await new DeflatingERC20__factory(wallet).deploy(tokenTotalSupply)

    // make a DTT<>weth dxswapPair
    await fixture.dxswapFactory.createPair(DTT.address, DTT2.address)
    const pairAddress = await fixture.dxswapFactory.getPair(DTT.address, DTT2.address)
  })

  afterEach(async function () {
    expect(await provider.getBalance(dxswapRouter.address)).to.eq(0)
  })

  async function addLiquidity(DTTAmount: BigNumber, DTT2Amount: BigNumber) {
    await DTT.approve(dxswapRouter.address, MaxUint256)
    await DTT2.approve(dxswapRouter.address, MaxUint256)
    await dxswapRouter.addLiquidity(
      DTT.address,
      DTT2.address,
      DTTAmount,
      DTT2Amount,
      DTTAmount,
      DTT2Amount,
      wallet.address,
      MaxUint256,
      overrides
    )
  }

  describe('swapExactTokensForTokensSupportingFeeOnTransferTokens', () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99)
    const DTT2Amount = expandTo18Decimals(5)
    const amountIn = expandTo18Decimals(1)

    beforeEach(async () => {
      await addLiquidity(DTTAmount, DTT2Amount)
    })

    it('DTT -> DTT2', async () => {
      await DTT.approve(dxswapRouter.address, MaxUint256)

      await dxswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [DTT.address, DTT2.address],
        wallet.address,
        MaxUint256,
        overrides
      )
    })
  })
})
