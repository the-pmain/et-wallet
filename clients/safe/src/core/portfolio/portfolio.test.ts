import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { priceRefKey, type IPriceQuote, type PriceMap } from '@/core/price'
import { TOKEN_STANDARD, type IToken } from '@/core/token'
import { toChainId, type Timestamp } from '@/core/types'

import { buildPortfolio, toWholeUnits, type ITokenAmount } from './portfolio'

const CHAIN_ID = toChainId(1n)

const NOW = 1_785_000_000_000 as Timestamp

function token(symbol: string, decimals: number, address: string | null): IToken {
  return {
    chainId: CHAIN_ID,
    address: address === null ? null : toAddress(address),
    standard: address === null ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol,
    name: symbol,
    decimals,
    logoUri: null,
    isCustom: false,
    isVerified: true,
    addedAt: NOW,
  }
}

const ETH = token('ETH', 18, null)
const USDC = token('USDC', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const WBTC = token('WBTC', 8, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')

function quote(price: number, change24hPercent: number | null = null): IPriceQuote {
  return { price, change24hPercent, updatedAt: NOW }
}

function prices(entries: readonly (readonly [IToken, IPriceQuote])[]): PriceMap {
  return new Map(
    entries.map(([item, value]) => [
      priceRefKey({ chainId: item.chainId, address: item.address }),
      value,
    ]),
  )
}

describe('toWholeUnits', () => {
  it('converts a whole number of smallest units', () => {
    expect(toWholeUnits(2_000_000n, 6)).toBe(2)
  })

  it('accounts for the fractional part', () => {
    expect(toWholeUnits(1_500_000n, 6)).toBeCloseTo(1.5, 10)
  })

  it('works with eighteen decimals without losing order of magnitude', () => {
    /* A direct `Number(balance)` on such magnitudes leaves the
       exact range before the division. */
    expect(toWholeUnits(10n ** 18n, 18)).toBe(1)
    expect(toWholeUnits(1_234_500_000_000_000_000n, 18)).toBeCloseTo(1.2345, 10)
  })

  it('works with zero decimals', () => {
    expect(toWholeUnits(7n, 0)).toBe(7)
  })

  it('a zero balance yields zero', () => {
    expect(toWholeUnits(0n, 18)).toBe(0)
  })
})

describe('buildPortfolio: valuation', () => {
  it('an empty list yields an empty summary', () => {
    const summary = buildPortfolio([], new Map())

    expect(summary.totalValue).toBe(0)
    expect(summary.positions).toEqual([])
  })

  it('values a position from the rate and the decimal count', () => {
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_500_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.totalValue).toBeCloseTo(1.5, 8)
  })

  it('adds positions with different decimal counts', () => {
    const amounts: ITokenAmount[] = [
      { token: ETH, balance: 10n ** 18n },
      { token: USDC, balance: 2_000_000n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.totalValue).toBeCloseTo(2002, 6)
  })

  it('computes position shares', () => {
    const amounts: ITokenAmount[] = [
      { token: ETH, balance: 10n ** 18n },
      { token: USDC, balance: 1_000_000_000n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(1000)],
        [USDC, quote(1)],
      ]),
    )

    const shares = summary.positions.map((position) => position.share)

    expect(shares[0]).toBeCloseTo(0.5, 8)
    expect(shares[1]).toBeCloseTo(0.5, 8)
  })

  it('orders positions by descending value', () => {
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.positions.map((position) => position.token.symbol)).toEqual(['ETH', 'USDC'])
  })
})

describe('buildPortfolio: unknown is not treated as zero', () => {
  it('a position without a rate is left out of the total', () => {
    /* Zero in place of an unknown rate would silently understate
       the portfolio. */
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: WBTC, balance: 100_000_000n },
    ]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.totalValue).toBeCloseTo(1, 8)
    expect(summary.positionsWithoutPrice).toBe(1)
  })

  it('a position without a rate stays on the list', () => {
    /* An asset whose rate is unknown is still an asset: not showing
       it would hide part of the owner's funds. */
    const amounts: ITokenAmount[] = [{ token: WBTC, balance: 100_000_000n }]
    const summary = buildPortfolio(amounts, new Map())

    expect(summary.positions).toHaveLength(1)
    expect(summary.positions[0]?.value).toBeNull()
    expect(summary.positions[0]?.share).toBeNull()
  })

  it('a position without a rate goes to the end of the list', () => {
    const amounts: ITokenAmount[] = [
      { token: WBTC, balance: 100_000_000n },
      { token: USDC, balance: 1_000_000n },
    ]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.positions.map((position) => position.token.symbol)).toEqual(['USDC', 'WBTC'])
  })

  it('a position with an unobtained balance is left out of the total', () => {
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: null },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.totalValue).toBeCloseTo(2000, 6)
    expect(summary.positionsWithoutBalance).toBe(1)
  })

  it('a zero balance is zero, not unknown', () => {
    /* The difference matters: "the account is empty" and "could not
       be learned" are different claims, and the first is checkable. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 0n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.positionsWithoutBalance).toBe(0)
    expect(summary.positions[0]?.value).toBe(0)
  })
})

describe('buildPortfolio: 24-hour change', () => {
  it('computes yesterday\'s valuation from the 24-hour rate change', () => {
    /* A price of 110 after a 10% rise means yesterday's 100. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(110, 10)]]))

    expect(summary.previousValue).toBeCloseTo(100, 6)
    expect(summary.change24hValue).toBeCloseTo(10, 6)
    expect(summary.change24hPercent).toBeCloseTo(10, 6)
  })

  it('computes a drop', () => {
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(90, -10)]]))

    expect(summary.change24hPercent).toBeCloseTo(-10, 6)
    expect(summary.change24hValue).toBeLessThan(0)
  })

  it('leaves the change unknown if no source provided it', () => {
    /* "The rate did not change" and "the change is unknown" are
       different claims, and the second must not be shown as zero. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.change24hPercent).toBeNull()
    expect(summary.change24hValue).toBeNull()
    expect(summary.previousValue).toBeNull()
  })

  it('a position without a 24-hour change does not inflate the portfolio change', () => {
    /* Otherwise that position would drop out of yesterday's total
       entirely, and the portfolio would show a rise of its full
       value. */
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 100_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [USDC, quote(1)],
        [ETH, quote(110, 10)],
      ]),
    )

    /* Yesterday: 100 stable + 100 ether = 200. Today: 100 + 110 = 210. */
    expect(summary.previousValue).toBeCloseTo(200, 6)
    expect(summary.change24hPercent).toBeCloseTo(5, 6)
  })
})

describe('buildPortfolio: quote age', () => {
  it('reports the instant of the oldest quote used', () => {
    const older = (NOW - 60_000) as Timestamp
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]

    const summary = buildPortfolio(
      amounts,
      prices([
        [USDC, { price: 1, change24hPercent: null, updatedAt: older }],
        [ETH, quote(2000)],
      ]),
    )

    expect(summary.oldestQuoteAt).toBe(older)
  })

  it('without valuations the age is unknown', () => {
    const summary = buildPortfolio([{ token: USDC, balance: 1_000_000n }], new Map())

    expect(summary.oldestQuoteAt).toBeNull()
  })
})
