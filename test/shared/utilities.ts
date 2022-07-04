import { BigNumber, Contract, ethers, providers } from 'ethers'
import { defaultAbiCoder, keccak256, solidityPack, toUtf8Bytes } from 'ethers/lib/utils'
import { DXswapPair } from './../../typechain'

export const MINIMUM_LIQUIDITY = ethers.BigNumber.from(10).pow(3)

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export function expandTo18Decimals(n: number): BigNumber {
  return ethers.BigNumber.from(n).mul(ethers.BigNumber.from(10).pow(18))
}

function getDomainSeparator(name: string, tokenAddress: string) {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes('1')),
        1,
        tokenAddress
      ]
    )
  )
}

export async function getApprovalDigest(
  token: Contract,
  approve: {
    owner: string
    spender: string
    value: BigNumber
  },
  nonce: BigNumber,
  deadline: BigNumber
): Promise<string> {
  const name = await token.name()
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address)
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        )
      ]
    )
  )
}

export async function mineBlock(provider: providers.JsonRpcProvider, timestamp: number, force = false): Promise<void> {
  if (force) {
    await provider.send("evm_setNextBlockTimestamp", [timestamp])
    return provider.send("evm_mine", [])
  }
  return provider.send('evm_mine', [timestamp])
  // return new Promise((resolve) => {resolve()})
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber) {
  return [reserve1.mul(ethers.BigNumber.from(2).pow(112)).div(reserve0), reserve0.mul(ethers.BigNumber.from(2).pow(112)).div(reserve1)]
}

export function reduce15Decimals(n: BigNumber): number {
  return (n.div(ethers.BigNumber.from(10).pow(15))).toNumber()
}

export async function sortTokens(tokenA: string, tokenB: string, pair: DXswapPair) {
  const token0 = tokenA === await pair.token0() ? tokenA : tokenB
  const token1 = tokenA === await pair.token0() ? tokenB : tokenA
  return [token0, token1]
}