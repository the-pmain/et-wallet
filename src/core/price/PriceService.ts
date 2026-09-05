import type { IClock, ILogger } from '@/core/platform'

import type { IPriceProvider, IPriceService } from './contracts'
import {
  priceRefKey,
  FIAT_CURRENCY,
  type FiatCurrency,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from './types'

const SERVICE_NAME = 'PriceService'

/**
 * How long a quote is treated as fresh.
 *
 * A minute is a compromise between display accuracy and how often
 * a third-party service is hit. Every call reveals the portfolio
 * composition and spends a hard free-tier limit, so polling more
 * often is not only useless but harmful.
 *
 * The rate is requested on action: opening the wallet, refresh,
 * network or account change. There is no background poll — it was
 * built and removed, see record A-171 in TECH_DEBT. Therefore the
 * quote on screen may be noticeably older than a minute, and next
 * to the estimate the time it is valid for is shown.
 */
const DEFAULT_TTL_MS = 60_000

export interface IPriceServiceDependencies {
  readonly provider: IPriceProvider
  readonly clock: IClock
  readonly logger: ILogger

  readonly currency?: FiatCurrency
  readonly ttlMs?: number
}

interface ICacheEntry {
  readonly quote: IPriceQuote

  /** Instant of receipt, not of the quote: staleness is counted from it. */
  readonly fetchedAt: number
}

/**
 * Rates with caching.
 *
 * A PARTIAL RESULT IS A NORMAL RESULT. A missing rate in the reply
 * means "unknown" and must differ from zero: an asset without a
 * rate must not zero the portfolio estimate, it must drop out of
 * it with an explicit mark.
 *
 * A SOURCE REFUSAL IS NOT THROWN OUTWARD. A portfolio without a
 * value is better than an empty screen: balances are known without
 * rates. The refusal reason is written to the log and available
 * through `lastError` — the UI must say that the value was not
 * obtained, not show it as zero.
 */
export class PriceService implements IPriceService {
  readonly #provider: IPriceProvider
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #currency: FiatCurrency
  readonly #ttlMs: number

  readonly #cache = new Map<string, ICacheEntry>()

  /** Reason of the last source refusal. `null` if there was none. */
  #lastError: string | null = null

  constructor(dependencies: IPriceServiceDependencies) {
    this.#provider = dependencies.provider
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#currency = dependencies.currency ?? FIAT_CURRENCY.Usd
    this.#ttlMs = dependencies.ttlMs ?? DEFAULT_TTL_MS
  }

  /** Source name. The user is entitled to know where the requests go. */
  get providerName(): string {
    return this.#provider.name
  }

  get lastError(): string | null {
    return this.#lastError
  }

  async getPrices(refs: readonly IPriceRef[]): Promise<PriceMap> {
    const now = this.#clock.now()
    const result = new Map<string, IPriceQuote>()
    const missing: IPriceRef[] = []

    for (const ref of refs) {
      const key = priceRefKey(ref)
      const cached = this.#cache.get(key)

      if (cached !== undefined && now - cached.fetchedAt < this.#ttlMs) {
        result.set(key, cached.quote)
      } else {
        missing.push(ref)
      }
    }

    if (missing.length === 0) {
      return result
    }

    try {
      const fresh = await this.#provider.getPrices(missing, this.#currency)

      for (const [key, quote] of fresh) {
        this.#cache.set(key, { quote, fetchedAt: now })
        result.set(key, quote)
      }

      this.#lastError = null
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error)

      this.#logger.warn('Prices could not be fetched', { reason: this.#lastError })

      /* Stale quotes are better than missing ones: a minute-old
         value shows the order of magnitude, and an empty screen
         shows nothing. Age is visible from `updatedAt`. */
      for (const ref of missing) {
        const key = priceRefKey(ref)
        const stale = this.#cache.get(key)

        if (stale !== undefined) {
          result.set(key, stale.quote)
        }
      }
    }

    return result
  }

  invalidate(): void {
    this.#cache.clear()
  }
}
