import type { ChainId } from '@/core/types'

import type { FiatCurrency, IPriceRef, PriceMap } from './types'

/**
 * Price source.
 *
 * A PARTIAL REPLY IS ORDINARY, NOT A FAULT. The source is not
 * obliged to know the rate of every requested asset: a token issued
 * yesterday has a rate nowhere. Therefore a map of what was found
 * is returned, not a list of the same length as the request: a
 * missing entry means "the rate is unknown" and must differ from
 * zero.
 *
 * A SOURCE REFUSAL IS AN EXCEPTION. An empty map and an unavailable
 * service are different events: the first means "there are no such
 * rates", the second — "could not find out". Collapsing them would
 * force the UI to show a portfolio without a value and not say why.
 */
export interface IPriceProvider {
  /** Stable identifier. Goes into the log and the UI. */
  readonly id: string

  /** Display name: the user is entitled to know where the requests go. */
  readonly name: string

  supports(chainId: ChainId): boolean

  /**
   * Requests rates.
   *
   * @throws Error if the source is unavailable or refused.
   */
  getPrices(refs: readonly IPriceRef[], currency: FiatCurrency): Promise<PriceMap>
}

export interface IPriceService {
  /**
   * Returns rates, hitting the source only for missing or stale
   * ones.
   *
   * Does not throw if some rates could not be obtained: what is
   * known is returned, what is unknown is absent from the map.
   */
  getPrices(refs: readonly IPriceRef[]): Promise<PriceMap>

  /** Clears the cache: the next request will go to the source. */
  invalidate(): void
}
