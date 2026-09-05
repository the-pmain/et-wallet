import {
  priceRefKey,
  type FiatCurrency,
  type IPriceProvider,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from '@/core'

export interface IFakePriceOptions {
  /**
   * Quotes keyed by `priceRefKey`.
   *
   * A missing entry means “rate unknown” — the same case as an
   * empty reply from a real service for an unknown contract.
   */
  readonly quotes?: ReadonlyMap<string, IPriceQuote>

  /** Failure reason. The source throws instead of answering. */
  readonly failure?: string
}

/**
 * Price-source double.
 *
 * Lets a test check the main property of the portfolio screen: a
 * position without a rate does not zero the estimate and does not
 * vanish from the list.
 */
export class FakePriceProvider implements IPriceProvider {
  readonly id = 'fake'
  readonly name = 'Price double'

  /** How many times the source was queried. Shows it is left alone without consent. */
  callCount = 0

  #options: IFakePriceOptions = {}

  configure(options: IFakePriceOptions): void {
    this.#options = options
  }

  supports(): boolean {
    return true
  }

  getPrices(refs: readonly IPriceRef[], _currency: FiatCurrency): Promise<PriceMap> {
    this.callCount += 1

    if (this.#options.failure !== undefined) {
      return Promise.reject(new Error(this.#options.failure))
    }

    const source = this.#options.quotes ?? new Map<string, IPriceQuote>()
    const result = new Map<string, IPriceQuote>()

    for (const ref of refs) {
      const key = priceRefKey(ref)
      const quote = source.get(key)

      if (quote !== undefined) {
        result.set(key, quote)
      }
    }

    return Promise.resolve(result)
  }
}
