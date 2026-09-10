import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { Address, ChainId } from '@/core/types'

/**
 * Built-in list of verified contracts.
 *
 * WHY IT EXISTS. The contract author chooses the token symbol and name:
 * anyone can ship a token labelled `USDC`, and it will look genuine
 * in the asset list. The only thing that distinguishes a fake from
 * the original is the contract address, and nobody will compare
 * forty-two characters by eye. The list moves that check into the wallet.
 *
 * WHAT THE MARK MEANS. Only that the address matched a known one.
 * It does not promise the project is sound, that the token is worth
 * anything, or that nothing will happen to it. The wallet cannot
 * promise that.
 *
 * VALUES WERE MEASURED, NOT TYPED FROM MEMORY. Each address was queried
 * on a live node: `symbol`, `name`, and `decimals` were read. The check
 * paid off immediately — from memory the list would have held wrong values:
 *
 * - on Polygon the Tether bridge answers with `USDT0`, not `USDT`;
 * - on Arbitrum — `USD₮0` with a typographic tenge sign;
 * - on Avalanche — `USDt` with a lowercase letter;
 * - on BNB Chain, USDT and USDC have EIGHTEEN decimals, not six
 *   as on Ethereum. An error here would distort the amount a trillionfold.
 *
 * THE LIST IS SMALL ON PURPOSE. It holds what was actually verified
 * and what most people use: stablecoins and the networks' wrapped coins.
 * Inflating it with hundreds of addresses "from internet lists" would
 * mean vouching for what nobody checked.
 */

/** Verified contract: address and what it answered when queried. */
export interface IVerifiedToken {
  readonly chainId: ChainId

  readonly address: Address

  /** Symbol read from the contract. */
  readonly symbol: string

  /** Name read from the contract. */
  readonly name: string

  /** Decimals read from the contract. */
  readonly decimals: number
}

/* Contract query date: 3 August 2026. Values can go stale — a contract
   with an updatable implementation is free to change its symbol, as the
   Tether bridge already did. The wallet shows a mismatch instead of
   hiding it: see `TokenService.add`. */
const VERIFIED: readonly IVerifiedToken[] = [
  /* --- Ethereum --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F'),
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
  },

  /* --- Optimism --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x4200000000000000000000000000000000000006'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- BNB Chain. Stablecoins here have eighteen decimals. --- */
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0x55d398326f99059fF775485246999027B3197955'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
  },

  /* --- Polygon --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    symbol: 'USDT0',
    name: 'USDT0',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Base --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Base,
    address: toAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Base,
    address: toAddress('0x4200000000000000000000000000000000000006'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Arbitrum --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'),
    symbol: 'USD₮0',
    name: 'USD₮0',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Avalanche --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
    symbol: 'USDt',
    name: 'TetherToken',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'),
    symbol: 'WAVAX',
    name: 'Wrapped AVAX',
    decimals: 18,
  },
]

/**
 * Lookup by the pair "network plus address".
 *
 * The key is lowercase: an address arrives with or without a checksum,
 * and the contract is distinguished by bytes, not spelling.
 */
const BY_KEY = new Map(
  VERIFIED.map((token) => [`${token.chainId.toString()}:${token.address.toLowerCase()}`, token]),
)

/** Verified contracts of the network. Order matches the declaration. */
export function listVerifiedTokens(chainId: ChainId): readonly IVerifiedToken[] {
  return VERIFIED.filter((token) => token.chainId === chainId)
}

/**
 * Verified contract by address.
 *
 * `null` means "not on the list", not "a fake": the list is deliberately
 * incomplete, and the vast majority of legitimate tokens are not on it.
 */
export function findVerifiedToken(chainId: ChainId, address: Address): IVerifiedToken | null {
  return BY_KEY.get(`${chainId.toString()}:${address.toLowerCase()}`) ?? null
}

/** Whether the address is on the verified list. */
export function isVerifiedToken(chainId: ChainId, address: Address): boolean {
  return findVerifiedToken(chainId, address) !== null
}
