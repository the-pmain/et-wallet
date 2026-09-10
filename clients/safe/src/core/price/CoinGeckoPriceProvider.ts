import { SystemClock, type IClock } from '@/core/platform'
import type { ChainId, Timestamp } from '@/core/types'

import { findCoinGeckoPlatform } from './coingecko-platforms'
import type { IPriceProvider } from './contracts'
import {
  priceRefKey,
  type FiatCurrency,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from './types'

const PROVIDER_ID = 'coingecko'
const PROVIDER_NAME = 'CoinGecko'

const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3'

/**
 * How many contract addresses go in one request.
 *
 * ONE IS NOT CAUTION, IT IS A MEASURED LIMIT. Free public access
 * replies with refusal `10012` to a request with two addresses:
 * «Number of contract addresses in the request exceeds the allowed limit
 * of 1 contract address». A batch larger than one is available only
 * with a key, so the size is a setting, not a constant.
 */
const DEFAULT_CONTRACT_BATCH_SIZE = 1

const DEFAULT_TIMEOUT_MS = 10_000

export interface ICoinGeckoOptions {
  /** Base URL. Replaced in tests and when using a paid node. */
  readonly baseUrl?: string

  /**
   * Demo or paid access key.
   *
   * Without a key the service answers one contract address per
   * request and hard-limits the rate.
   */
  readonly apiKey?: string

  /** How many contract addresses to send in one request. */
  readonly contractBatchSize?: number

  readonly timeoutMs?: number

  readonly fetchImpl?: typeof fetch

  /**
   * Time source.
   *
   * Needed for replies where the service did not give a quote
   * instant: the current time is substituted, and it must be
   * controllable in a test, not taken from the system clock
   * directly.
   */
  readonly clock?: IClock
}

/**
 * Rates from CoinGecko.
 *
 * WHAT THE SERVICE LEARNS ABOUT THE USER. Contract addresses whose
 * rates were requested, the network identifier, and the IP address.
 * That is enough to learn the portfolio composition, but NOT enough
 * to tie it to a specific wallet address: the owner's address is
 * not passed here in any form and cannot be — the method does not
 * accept it.
 *
 * That is why the source is turned on only by explicit user
 * consent, not by default.
 *
 * REQUESTS ARE SPLIT INTO TWO KINDS. Native currency is requested
 * by coin id (`simple/price`), tokens by contract address
 * (`simple/token_price/{platform}`). These are different endpoints
 * with different limits, and they cannot be merged.
 */
export class CoinGeckoPriceProvider implements IPriceProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  readonly #baseUrl: string
  readonly #apiKey: string | null
  readonly #contractBatchSize: number
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch
  readonly #clock: IClock

  constructor(options: ICoinGeckoOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#apiKey = options.apiKey ?? null
    this.#contractBatchSize = options.contractBatchSize ?? DEFAULT_CONTRACT_BATCH_SIZE
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.#clock = options.clock ?? new SystemClock()
  }

  supports(chainId: ChainId): boolean {
    return findCoinGeckoPlatform(chainId) !== null
  }

  async getPrices(refs: readonly IPriceRef[], currency: FiatCurrency): Promise<PriceMap> {
    const supported = refs.filter((ref) => this.supports(ref.chainId))

    if (supported.length === 0) {
      return new Map()
    }

    const quotes = new Map<string, IPriceQuote>()

    /* A refusal on one group does not cancel the others: the ether
       rate is useful even when one token's price could not be
       obtained. But if nothing succeeded, an exception goes out —
       an empty reply and an unavailable service read differently. */
    let failures = 0
    let attempts = 0

    /* The first refusal reason is kept. A generic "source
       unavailable" in its place would hide the only thing that
       says what to do next: exceeding the address limit is fixed
       by a setting, a rate limit by waiting, and those are
       different actions. */
    let firstError: Error | null = null

    for (const [chainKey, group] of groupByChain(supported)) {
      const platform = findCoinGeckoPlatform(group[0]?.chainId ?? (chainKey as unknown as ChainId))

      if (platform === null) {
        continue
      }

      const natives = group.filter((ref) => ref.address === null)
      const tokens = group.filter((ref) => ref.address !== null)

      if (natives.length > 0) {
        attempts += 1

        try {
          await this.#loadNative(natives, platform.nativeCoinId, currency, quotes)
        } catch (error) {
          failures += 1
          firstError ??= toError(error)
        }
      }

      for (const batch of chunk(tokens, this.#contractBatchSize)) {
        attempts += 1

        try {
          await this.#loadTokens(batch, platform.platformId, currency, quotes)
        } catch (error) {
          failures += 1
          firstError ??= toError(error)
        }
      }
    }

    if (attempts > 0 && failures === attempts && firstError !== null) {
      throw new Error(`Prices could not be fetched: ${firstError.message}`, { cause: firstError })
    }

    return quotes
  }

  /** Native-currency rate is requested by coin id. */
  async #loadNative(
    refs: readonly IPriceRef[],
    coinId: string,
    currency: FiatCurrency,
    into: Map<string, IPriceQuote>,
  ): Promise<void> {
    const url = new URL(`${this.#baseUrl}/simple/price`)

    url.searchParams.set('ids', coinId)
    url.searchParams.set('vs_currencies', currency)
    url.searchParams.set('include_24hr_change', 'true')
    url.searchParams.set('include_last_updated_at', 'true')

    const payload = await this.#request(url)
    const quote = readQuote(payload[coinId], currency, this.#clock)

    if (quote === null) {
      return
    }

    for (const ref of refs) {
      into.set(priceRefKey(ref), quote)
    }
  }

  /** Token rates are requested by contract addresses. */
  async #loadTokens(
    refs: readonly IPriceRef[],
    platformId: string,
    currency: FiatCurrency,
    into: Map<string, IPriceQuote>,
  ): Promise<void> {
    if (refs.length === 0) {
      return
    }

    const url = new URL(`${this.#baseUrl}/simple/token_price/${platformId}`)

    url.searchParams.set(
      'contract_addresses',
      refs.map((ref) => (ref.address ?? '').toLowerCase()).join(','),
    )
    url.searchParams.set('vs_currencies', currency)
    url.searchParams.set('include_24hr_change', 'true')
    url.searchParams.set('include_last_updated_at', 'true')

    const payload = await this.#request(url)

    for (const ref of refs) {
      /* The reply arrives with addresses in lowercase regardless of
         the form they were sent in. */
      const quote = readQuote(payload[(ref.address ?? '').toLowerCase()], currency, this.#clock)

      if (quote !== null) {
        into.set(priceRefKey(ref), quote)
      }
    }
  }

  /**
   * Performs the request.
   *
   * AN ERROR IN THE REPLY BODY WITH STATUS 200 IS ORDINARY FOR THIS
   * SERVICE. Exceeding the address limit arrives that way, and
   * without checking the `error_code` field such a reply would be
   * parsed as "there are no rates".
   */
  async #request(url: URL): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: 'application/json' }

    if (this.#apiKey !== null) {
      headers['x-cg-demo-api-key'] = this.#apiKey
    }

    const response = await this.#fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
      /* Neither cookies nor authorization headers: the browser
         must not attach anything the user does not know about. */
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      throw new Error(`The price source responded with ${String(response.status)}.`)
    }

    const payload: unknown = await response.json()

    if (typeof payload !== 'object' || payload === null) {
      throw new Error('The price source returned an unexpected response.')
    }

    const record = payload as Record<string, unknown>

    if (record['error_code'] !== undefined) {
      throw new Error(readErrorMessage(record))
    }

    return record
  }
}

/** Converts a caught value to an error without losing the message. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function readErrorMessage(payload: Record<string, unknown>): string {
  const status = payload['status']

  if (typeof status === 'object' && status !== null) {
    const message = (status as Record<string, unknown>)['error_message']

    if (typeof message === 'string') {
      return message
    }
  }

  return 'The price source refused the request.'
}

/**
 * Parses one quote.
 *
 * Returns `null` if there is no price: a record without a price
 * means the rate is unknown. Substituting zero would declare the
 * asset worth nothing.
 */
function readQuote(entry: unknown, currency: FiatCurrency, clock: IClock): IPriceQuote | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const record = entry as Record<string, unknown>
  const price = record[currency]

  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null
  }

  const change = record[`${currency}_24h_change`]
  const updatedAt = record['last_updated_at']

  return {
    price,
    change24hPercent: typeof change === 'number' && Number.isFinite(change) ? change : null,
    /* The service gives the instant in seconds; the internal type
       is milliseconds. */
    updatedAt: typeof updatedAt === 'number' ? ((updatedAt * 1000) as Timestamp) : clock.now(),
  }
}

/** Splits the request by network: each has its own platform id. */
function groupByChain(refs: readonly IPriceRef[]): ReadonlyMap<string, readonly IPriceRef[]> {
  const groups = new Map<string, IPriceRef[]>()

  for (const ref of refs) {
    const key = ref.chainId.toString()
    const bucket = groups.get(key)

    if (bucket === undefined) {
      groups.set(key, [ref])
    } else {
      bucket.push(ref)
    }
  }

  return groups
}

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const parts: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size))
  }

  return parts
}
