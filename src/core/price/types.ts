import type { Address, ChainId, Timestamp } from '@/core/types'

/**
 * Valuation currency.
 *
 * Only one for now. An enum, not a string, so adding a second
 * currency is a change in one place, not a search across the code.
 */
export const FIAT_CURRENCY = {
  Usd: 'usd',
} as const

export type FiatCurrency = (typeof FIAT_CURRENCY)[keyof typeof FIAT_CURRENCY]

/**
 * Quote of one asset.
 *
 * EVERY FIELD EXCEPT THE PRICE MAY BE MISSING. A price source is
 * not obliged to know the daily change: a just-issued token has
 * none, and for an illiquid one it is meaningless. `null` means
 * "unknown" and must be shown as a dash, not zero: "the rate did
 * not change" and "the change is unknown" are different claims.
 */
export interface IPriceQuote {
  /**
   * Price of one whole unit of the asset.
   *
   * A floating-point number — deliberately. This is an estimate for
   * display, not a computed quantity: no transaction is formed from
   * it. Amounts that are signed are counted in smallest units as
   * integers and never pass through rates.
   */
  readonly price: number

  /** Daily rate change in percent. `null` if the source did not give it. */
  readonly change24hPercent: number | null

  /** Instant at which the source considers the quote valid. */
  readonly updatedAt: Timestamp
}

/**
 * Quote key.
 *
 * The pair "network + contract address" is required: the same
 * address on different networks is different assets. `null` in the
 * address means the network's native currency.
 */
export interface IPriceRef {
  readonly chainId: ChainId
  readonly address: Address | null
}

/**
 * String quote key for maps.
 *
 * Objects used as `Map` keys are compared by reference, not
 * contents: two `IPriceRef` that mean the same would give two
 * different entries and a cache miss on every request.
 */
export function priceRefKey(ref: IPriceRef): string {
  return `${ref.chainId.toString()}:${ref.address === null ? 'native' : ref.address.toLowerCase()}`
}

/** Quotes found by the source. The key is the result of `priceRefKey`. */
export type PriceMap = ReadonlyMap<string, IPriceQuote>
