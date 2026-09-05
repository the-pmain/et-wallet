import { describe, expect, it } from 'vitest'

import {
  TOKEN_STANDARD,
  buildPortfolio,
  priceRefKey,
  toAddress,
  toChainId,
  type IBalance,
  type IPriceQuote,
  type IToken,
  type PriceMap,
  type Timestamp,
} from '@/core'

import { estimateNativeValue } from './asset-value'

const ETHEREUM = toChainId(1n)
const BNB_CHAIN = toChainId(56n)

const NOW = 1_785_000_000_000 as Timestamp

function token(chainId: typeof ETHEREUM, symbol: string, decimals: number, address: string | null) {
  return {
    chainId,
    address: address === null ? null : toAddress(address),
    standard: address === null ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol,
    name: symbol,
    decimals,
    logoUri: null,
    isCustom: false,
    isVerified: true,
    addedAt: NOW,
  } satisfies IToken
}

const ETH = token(ETHEREUM, 'ETH', 18, null)
const USDC = token(ETHEREUM, 'USDC', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const BNB = token(BNB_CHAIN, 'BNB', 18, null)

function quote(price: number): IPriceQuote {
  return { price, change24hPercent: null, updatedAt: NOW }
}

function prices(entries: readonly (readonly [IToken, IPriceQuote])[]): PriceMap {
  return new Map(
    entries.map(([item, value]) => [
      priceRefKey({ chainId: item.chainId, address: item.address }),
      value,
    ]),
  )
}

/** Native-currency balance of the given chain. */
function balanceOf(raw: bigint, chainId = ETHEREUM): IBalance {
  return { raw, decimals: 18, chainId, isStale: false } as unknown as IBalance
}

describe('estimateNativeValue: the price of exactly the figure shown', () => {
  it('multiplies the displayed balance by the native-currency rate', () => {
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), portfolio)).toBe(6000)
  })

  it('computes from the fresh balance, not from the summary estimate', () => {
    /* Main check of this module. Refreshing the balance does not
       recompute the portfolio, so the summary is allowed to lag.
       A ready position `value` would describe the previous amount
       next to the new one. */
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(portfolio.positions[0]?.value).toBe(6000)
    expect(estimateNativeValue(balanceOf(5n * 10n ** 18n), portfolio)).toBe(15_000)
  })

  it('stays silent when the native-currency rate is unknown', () => {
    /* Only the token has a rate. Substituting zero would claim ether
       is worthless. */
    const portfolio = buildPortfolio(
      [
        { token: ETH, balance: 2n * 10n ** 18n },
        { token: USDC, balance: 10n ** 6n },
      ],
      prices([[USDC, quote(1)]]),
    )

    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), portfolio)).toBeNull()
  })

  it('stays silent when the summary is from another chain', () => {
    /* Gap while switching chains: the balance is already BNB, the
       summary is still ether. Without a match, 1.5 BNB would be
       valued at $4500. */
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(balanceOf(15n * 10n ** 17n, BNB_CHAIN), portfolio)).toBeNull()
  })

  it('values another chain\'s native currency at its own rate', () => {
    const portfolio = buildPortfolio(
      [{ token: BNB, balance: 15n * 10n ** 17n }],
      prices([[BNB, quote(600)]]),
    )

    expect(estimateNativeValue(balanceOf(15n * 10n ** 17n, BNB_CHAIN), portfolio)).toBe(900)
  })

  it('stays silent without a balance and without a summary', () => {
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(null, portfolio)).toBeNull()
    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), null)).toBeNull()
  })

  it('values a zero balance as zero, not as unknown', () => {
    /* A legitimate zero: the balance is known to be zero and a rate
       was received. A dash here would be the same lie as zero in
       place of a dash. */
    const portfolio = buildPortfolio([{ token: ETH, balance: 0n }], prices([[ETH, quote(3000)]]))

    expect(estimateNativeValue(balanceOf(0n), portfolio)).toBe(0)
  })
})
