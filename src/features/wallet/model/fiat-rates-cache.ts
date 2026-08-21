import { FiatRatesClient } from '@/core'

import { USD_ONLY_RATES, type IFiatRates } from '../lib/display-currency'

/**
 * Курсы EUR/GBP к доллару. Один запрос на сессию приложения.
 */
export class FiatRatesCache {
  #snapshot: IFiatRates = USD_ONLY_RATES
  #load: Promise<void> | null = null
  #generation = 0
  readonly #listeners = new Set<() => void>()
  readonly #client: FiatRatesClient

  constructor(client: FiatRatesClient = new FiatRatesClient()) {
    this.#client = client
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot(): IFiatRates {
    return this.#snapshot
  }

  reset(): void {
    this.#generation += 1
    this.#load = null
    this.#snapshot = USD_ONLY_RATES
    this.#notify()
  }

  async ensureLoaded(): Promise<void> {
    if (this.#load !== null) {
      return this.#load
    }

    const generation = this.#generation
    this.#load = this.#client
      .getRates()
      .then((fetched) => {
        if (generation !== this.#generation) {
          return
        }

        this.#snapshot = { USD: 1, EUR: fetched.EUR, GBP: fetched.GBP }
        this.#notify()
      })
      .catch(() => {
        /* Канонический показ остаётся в долларах. */
      })

    return this.#load
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

export const appFiatRates = new FiatRatesCache()
