import { expandTo18Decimals } from './utilities'
import { DXswapFactory, DXswapFactory__factory, DXswapPair, DXswapPair__factory, DXswapRelayer, DXswapRelayer__factory, DXswapRouter, DXswapRouter__factory, ERC20Mintable, ERC20Mintable__factory, OracleCreator, OracleCreator__factory, RouterEventEmitter, RouterEventEmitter__factory, WETH9, WETH9__factory, DeflatingERC20__factory, DeflatingERC20 } from './../../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

interface DXswapFixture {
  token0: ERC20Mintable
  token1: ERC20Mintable
  token2: ERC20Mintable
  WETH: WETH9
  WETHPartner: ERC20Mintable
  dxswapFactory: DXswapFactory
  routerEventEmitter: RouterEventEmitter
  router: DXswapRouter
  WETHPair: DXswapPair
  uniWETHPair: DXswapPair
  dxswapPair: DXswapPair
  dxswapRouter: DXswapRouter
  uniFactory: DXswapFactory
  uniRouter: DXswapRouter
  uniPair: DXswapPair
  oracleCreator: OracleCreator
  dxRelayer: DXswapRelayer
  DTT: DeflatingERC20
  DTT2: DeflatingERC20
  DTTPair: DXswapPair
  WETHDTTPair: DXswapPair
}

export async function dxswapFixture(wallet: SignerWithAddress): Promise<DXswapFixture> {

  // deploy tokens
  const tokenA = await new ERC20Mintable__factory(wallet).deploy(expandTo18Decimals(10000))
  const tokenB = await new ERC20Mintable__factory(wallet).deploy(expandTo18Decimals(10000))
  const tokenC = await new ERC20Mintable__factory(wallet).deploy(expandTo18Decimals(10000))

  const WETH = await new WETH9__factory(wallet).deploy()
  const WETHPartner = await new ERC20Mintable__factory(wallet).deploy(expandTo18Decimals(10000))

  const DTT = await new DeflatingERC20__factory(wallet).deploy(expandTo18Decimals(10000))
  const DTT2 = await new DeflatingERC20__factory(wallet).deploy(expandTo18Decimals(10000))

  // deploy DXswapFactory
  const dxswapFactory = await new DXswapFactory__factory(wallet).deploy(wallet.address)

  // deploy UniswapFactory
  const uniFactory = await new DXswapFactory__factory(wallet).deploy(wallet.address)

  // deploy router  
  const router = await new DXswapRouter__factory(wallet).deploy(dxswapFactory.address, WETH.address)
  const dxswapRouter = await new DXswapRouter__factory(wallet).deploy(dxswapFactory.address, WETH.address)
  const uniRouter = await new DXswapRouter__factory(wallet).deploy(uniFactory.address, WETH.address)

  // event emitter for testing
  const routerEventEmitter = await new RouterEventEmitter__factory(wallet).deploy()

  // initialize DXswapPair factory
  const dxSwapPair_factory = await new DXswapPair__factory(wallet).deploy()

  // create pairs
  await dxswapFactory.createPair(tokenA.address, tokenB.address)
  const pairAddress = await dxswapFactory.getPair(tokenA.address, tokenB.address)
  const dxswapPair = dxSwapPair_factory.attach(pairAddress)

  // get addresses of sorted pair tokens
  const token0Address = await dxswapPair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA
  const token2 = tokenC

  // deploy weth/erc20 pair
  await dxswapFactory.createPair(WETH.address, WETHPartner.address)
  const WETHPairAddress = await dxswapFactory.getPair(WETH.address, WETHPartner.address)
  const WETHPair = dxSwapPair_factory.attach(WETHPairAddress)

  // deploy weth/erc20 pair Uniswap
  await uniFactory.createPair(WETH.address, WETHPartner.address)
  const uniWETHPairAddress = await uniFactory.getPair(WETH.address, WETHPartner.address)
  const uniWETHPair = dxSwapPair_factory.attach(uniWETHPairAddress)

  // deploy deflating tokens pair
  await dxswapFactory.createPair(DTT.address, DTT2.address)
  const DTTPairAddress = await dxswapFactory.getPair(DTT.address, DTT2.address)
  const DTTPair = dxSwapPair_factory.attach(DTTPairAddress)

  // deploy weth/deflating_token pair
  await dxswapFactory.createPair(WETH.address, DTT.address)
  const WETHDTTPairAddress = await dxswapFactory.getPair(WETH.address, DTT.address)
  const WETHDTTPair = dxSwapPair_factory.attach(WETHDTTPairAddress)

  // initialize DXswapPair
  await uniFactory.createPair(tokenA.address, tokenB.address)
  const uniPairAddress = await uniFactory.getPair(tokenA.address, tokenB.address)
  const uniPair = dxSwapPair_factory.attach(uniPairAddress)

  // deploy oracleCreator
  const oracleCreator = await new OracleCreator__factory(wallet).deploy()

  // deploy Relayer and TradeRelayer
  const dxRelayer = await new DXswapRelayer__factory(wallet).deploy(wallet.address, dxswapFactory.address, dxswapRouter.address, uniFactory.address, uniRouter.address, WETH.address, oracleCreator.address)

  return {
    token0,
    token1,
    token2,
    WETH,
    WETHPartner,
    dxswapFactory,
    routerEventEmitter,
    router,
    WETHPair,
    uniWETHPair,
    dxswapPair,
    dxswapRouter,
    uniFactory,
    uniRouter,
    uniPair,
    oracleCreator,
    dxRelayer,
    DTT,
    DTT2,
    DTTPair,
    WETHDTTPair
  }
}