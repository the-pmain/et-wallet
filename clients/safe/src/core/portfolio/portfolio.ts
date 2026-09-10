import { priceRefKey, type PriceMap } from '@/core/price'
import type { IToken } from '@/core/token'

import type { IPortfolioPosition, IPortfolioSummary } from './types'

export interface ITokenAmount {
  readonly token: IToken

  /** `null` means "could not be obtained", not zero. */
  readonly balance: bigint | null
}

/**
 * Empty summary.
 *
 * A separate constant, not assembled in place: a state snapshot is
 * compared by reference, and a new object on every call would cause
 * an extra re-render.
 */
export const EMPTY_PORTFOLIO: IPortfolioSummary = {
  totalValue: 0,
  previousValue: null,
  change24hValue: null,
  change24hPercent: null,
  positions: [],
  positionsWithoutPrice: 0,
  positionsWithoutBalance: 0,
  oldestQuoteAt: null,
}

/**
 * Converts a balance in whole token units to a number.
 *
 * PRECISION IS LOST HERE, AND THAT IS ACCEPTABLE ONLY BECAUSE THE
 * RESULT GOES TO THE SCREEN. Amounts that are signed are counted as
 * integers in smallest units and never pass through this conversion:
 * the portfolio valuation takes part in forming no transaction.
 *
 * Division is done as a fraction of two `bigint`s, not through
 * `Number(balance)`: for a token with eighteen decimals the whole
 * balance is outside the exact range of `number`, and a direct
 * conversion would distort the result before the division.
 */
export function toWholeUnits(balance: bigint, decimals: number): number {
  if (decimals === 0) {
    return Number(balance)
  }

  const divisor = 10n ** BigInt(decimals)
  const whole = balance / divisor
  const remainder = balance % divisor

  return Number(whole) + Number(remainder) / Number(divisor)
}

/**
 * Builds a portfolio summary from balances and rates.
 *
 * THE FUNCTION IS PURE AND DOES NOT TOUCH THE NETWORK. Balances and
 * rates were obtained earlier; this is only arithmetic. That lets
 * the most responsible part — what enters the total and what drops
 * out of it — be checked by a test with no network call.
 */
export function buildPortfolio(
  amounts: readonly ITokenAmount[],
  prices: PriceMap,
): IPortfolioSummary {
  if (amounts.length === 0) {
    return EMPTY_PORTFOLIO
  }

  const positions: IPortfolioPosition[] = []

  let totalValue = 0
  let previousValue = 0
  let hasChangeData = false
  let positionsWithoutPrice = 0
  let positionsWithoutBalance = 0
  let oldestQuoteAt: number | null = null

  for (const { token, balance } of amounts) {
    const quote =
      prices.get(priceRefKey({ chainId: token.chainId, address: token.address })) ?? null

    if (balance === null) {
      positionsWithoutBalance += 1
      positions.push({ token, balance: null, quote, value: null, share: null })
      continue
    }

    if (quote === null) {
      positionsWithoutPrice += 1
      positions.push({ token, balance, quote: null, value: null, share: null })
      continue
    }

    const value = toWholeUnits(balance, token.decimals) * quote.price

    totalValue += value

    if (quote.change24hPercent === null) {
      /* The change is unknown — yesterday's price is taken as
         today's. Otherwise the position would drop out of
         yesterday's total entirely, and the portfolio change would
         be inflated by its full value. */
      previousValue += value
    } else {
      hasChangeData = true
      previousValue += value / (1 + quote.change24hPercent / 100)
    }

    if (oldestQuoteAt === null || quote.updatedAt < oldestQuoteAt) {
      oldestQuoteAt = quote.updatedAt
    }

    positions.push({ token, balance, quote, value, share: null })
  }

  const withShares = positions.map((position) => ({
    ...position,
    share: position.value === null || totalValue === 0 ? null : position.value / totalValue,
  }))

  return {
    totalValue,
    previousValue: hasChangeData ? previousValue : null,
    change24hValue: hasChangeData ? totalValue - previousValue : null,
    /* Division by zero yields infinity, not an error: a portfolio
       that was worth nothing yesterday has no percent change. */
    change24hPercent:
      hasChangeData && previousValue > 0
        ? ((totalValue - previousValue) / previousValue) * 100
        : null,
    positions: sortByValue(withShares),
    positionsWithoutPrice,
    positionsWithoutBalance,
    oldestQuoteAt,
  }
}

/**
 * Orders positions by descending valuation.
 *
 * Positions without a valuation go to the end, they do not vanish:
 * an asset whose rate is unknown is still an asset, and not showing
 * it would hide part of the owner's funds.
 */
function sortByValue(positions: readonly IPortfolioPosition[]): readonly IPortfolioPosition[] {
  return [...positions].sort((left, right) => {
    if (left.value === null && right.value === null) {
      return 0
    }

    if (left.value === null) {
      return 1
    }

    if (right.value === null) {
      return -1
    }

    return right.value - left.value
  })
}
