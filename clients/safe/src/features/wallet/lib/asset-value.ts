import {
  toWholeUnits,
  type Address,
  type ChainId,
  type IBalance,
  type IPortfolioSummary,
  type IPriceQuote,
} from '@/core'

/**
 * Dollar estimates of displayed amounts.
 *
 * Every figure here is an estimate and is for the screen only. They
 * come from balance × a third-party rate. None of them enter a
 * transaction: signed amounts are integers in smallest units.
 */

/**
 * Find an asset quote in the portfolio summary.
 *
 * The chain is matched. Balances and the summary do not update at the
 * same time when switching networks, so there is a window where the
 * summary is still the previous chain. Without a match, a BNB balance
 * would be valued at the ether rate — hundreds of times too high.
 *
 * `null` address means native currency: it has no contract by design.
 */
export function findQuote(
  portfolio: IPortfolioSummary | null,
  chainId: ChainId | null,
  address: Address | null,
): IPriceQuote | null {
  if (portfolio === null || chainId === null) {
    return null
  }

  const position = portfolio.positions.find(
    ({ token }) => token.chainId === chainId && token.address === address,
  )

  return position?.quote ?? null
}

/**
 * Value a quantity from a quote.
 *
 * Computed from the displayed quantity, not taken ready-made from the
 * position. The summary already has `value` per position, but balances
 * update separately from rates: after a refresh that ready value would
 * describe the previous quantity sitting next to a new one.
 *
 * So only the rate is taken from the summary and multiplied by exactly
 * the figure on screen. The rate may be stale — that is what "approx"
 * and the quote time are for. A quantity priced as another quantity
 * is not the same kind of property.
 *
 * `null` means no estimate: quantity or rate unknown. Zero is never
 * substituted: "value unknown" and "worth zero" are different claims,
 * and the second in place of the first reads as funds gone.
 */
export function estimateValue(
  balance: bigint | null,
  decimals: number,
  quote: IPriceQuote | null,
): number | null {
  if (balance === null || quote === null) {
    return null
  }

  return toWholeUnits(balance, decimals) * quote.price
}

/**
 * Estimate of the displayed native-currency balance.
 *
 * Separate because native balance arrives as its own snapshot field,
 * not from the token list — with its own chain and decimals.
 */
export function estimateNativeValue(
  balance: IBalance | null,
  portfolio: IPortfolioSummary | null,
): number | null {
  if (balance === null) {
    return null
  }

  return estimateValue(balance.raw, balance.decimals, findQuote(portfolio, balance.chainId, null))
}
