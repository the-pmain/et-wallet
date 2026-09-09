import type { ITokenEntry } from './types.ts'

/**
 * Recommended-token catalog.
 *
 * HOW A RECORD GETS IN. The address must be confirmed by two
 * independent sources:
 *
 * 1. a published token list (Uniswap Labs Default, version 22.6.0);
 * 2. the live on-chain contract: `symbol()`, `name()` and `decimals()`
 *    are asked of a node and checked against the list.
 *
 * A SOURCE MISMATCH DROPS THE RECORD; IT DOES NOT PICK ONE VARIANT.
 * That is why Polygon USDT
 * (`0xc2132D05D31c914a87C6611C10748AEb04B58e8F`) left the catalog:
 * the list calls it `USDT` / "Tether USD", the contract answered
 * `USDT0`. Until the mismatch is explained, the address cannot be
 * recommended.
 *
 * WHY ADDRESSES ARE NOT TYPED FROM MEMORY. A hex address is unchecked
 * when you read the code: one wrong character is a different contract,
 * and an address the wallet recommends is where the user will send
 * money. An on-chain transfer is irreversible.
 *
 * `provenance` IS SENT TO THE CLIENT. A "verified" flag is not
 * checkable; origin is. The user is entitled to see what the
 * recommendation rests on and decide whether that is enough.
 *
 * BNB Chain AND Avalanche HAVE NO RECORDS: they are not covered by
 * the list we used, and checking them against one source is not
 * checking at all. An empty list for those networks means "no
 * confirmed recommendations", not "there are no tokens".
 */

const TOKEN_LIST_SOURCE = 'Uniswap Labs Default 22.6.0'

const ON_CHAIN_SOURCE = 'Checked symbol/name/decimals against the contract'

const VERIFIED_AT = '2026-07-31'

const PROVENANCE = [TOKEN_LIST_SOURCE, ON_CHAIN_SOURCE]

function token(
  chainId: bigint,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
): ITokenEntry {
  return {
    chainId,
    address,
    symbol,
    name,
    decimals,
    provenance: PROVENANCE,
    verifiedAt: VERIFIED_AT,
  }
}

export const TOKENS: readonly ITokenEntry[] = [
  /* Ethereum */
  token(1n, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6),
  token(1n, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6),
  token(1n, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai Stablecoin', 18),
  token(1n, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'WBTC', 'Wrapped BTC', 8),
  token(1n, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18),

  /* OP Mainnet */
  token(10n, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USD Coin', 6),
  token(10n, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6),
  token(10n, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18),
  token(10n, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),

  /* Polygon */
  token(137n, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USD Coin', 6),
  token(137n, '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 'DAI', '(PoS) Dai Stablecoin', 18),
  token(137n, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 'WETH', 'Wrapped Ether', 18),

  /* Base */
  token(8453n, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6),
  token(8453n, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 'DAI', 'Dai Stablecoin', 18),
  token(8453n, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),

  /* Arbitrum One */
  token(42161n, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USD Coin', 6),
  token(42161n, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18),
  token(42161n, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 'Wrapped Ether', 18),
]
