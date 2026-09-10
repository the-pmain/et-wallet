import type { IPriceQuote } from '@/core/price'
import type { IToken } from '@/core/token'

/**
 * One portfolio position.
 *
 * THREE DIFFERENT "UNKNOWNS" ARE DISTINGUISHED. The balance may not
 * have been obtained (`balance: null`), the rate may be unknown
 * (`quote: null`), and only when both are present does a valuation
 * appear (`value`). Collapsing these cases to zero would show a
 * confident "zero" where the wallet knows nothing — and to the
 * owner of the funds that reads as a disappearance.
 */
export interface IPortfolioPosition {
  readonly token: IToken

  /** Balance in smallest units. `null` — could not be obtained. */
  readonly balance: bigint | null

  /** Quote. `null` — the rate is unknown. */
  readonly quote: IPriceQuote | null

  /**
   * Valuation of the position.
   *
   * `null` if the balance or the rate is unknown. A floating-point
   * number on purpose: this is a display quantity, and no
   * transaction is built from it.
   */
  readonly value: number | null

  /**
   * Share of the portfolio, from zero to one.
   *
   * `null` for positions without a valuation: a share of an unknown
   * quantity is unknown, and putting zero here would declare the
   * position negligible.
   */
  readonly share: number | null
}

/**
 * Portfolio summary.
 *
 * THE VALUATION IS COUNTED ONLY FROM WHAT IS KNOWN. Positions
 * without a rate or without a balance are left out of the total and
 * listed separately: a total that silently omitted half the assets
 * is a wrong total presented as a right one.
 */
export interface IPortfolioSummary {
  /** Valuation of the positions that were counted. */
  readonly totalValue: number

  /**
   * Valuation of one day ago at the same composition.
   *
   * `null` if no counted position has a known 24-hour rate change.
   */
  readonly previousValue: number | null

  /**
   * Change of the valuation over a day, in money and percent.
   *
   * THIS IS A CHANGE OF RATES, NOT A CHANGE OF THE PORTFOLIO. The
   * calculation assumes an unchanged composition: buys, sells, and
   * transfers during the day are not in it. Calling this "portfolio
   * value change" would credit the user with income they did not
   * receive.
   */
  readonly change24hValue: number | null
  readonly change24hPercent: number | null

  /** Positions by descending valuation; positions without one at the end. */
  readonly positions: readonly IPortfolioPosition[]

  /** How many positions were left out of the valuation for an unknown rate. */
  readonly positionsWithoutPrice: number

  /** How many positions were left out because the balance was not obtained. */
  readonly positionsWithoutBalance: number

  /** Instant of the oldest quote used. `null` if there is no valuation. */
  readonly oldestQuoteAt: number | null
}
