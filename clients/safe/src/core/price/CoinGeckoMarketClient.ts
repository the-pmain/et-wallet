import { parseMarketList, type IMarketCoin } from './markets'

const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_PER_PAGE = 50

/** Settings of the public-market client. */
export interface ICoinGeckoMarketClientOptions {
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly timeoutMs?: number
  readonly perPage?: number
  readonly fetchImpl?: typeof fetch
}

/**
 * Public CoinGecko rate table.
 *
 * THE REQUEST DOES NOT NAME THE WALLET. It has no account or contract
 * addresses — only the quote currency, sort, and page size. That is
 * a different request from `simple/token_price`: that one discloses
 * the portfolio and therefore lives behind consent. This one is a
 * market catalog, and it can be shown on the home screen without
 * that consent.
 *
 * THE SEVEN-DAY SERIES COMES IN THE SAME REQUEST. `sparkline=true`
 * does not open a second call: the points sit in `sparkline_in_7d`
 * of the `/coins/markets` response. A separate `market_chart` on
 * every expanded asset would eat the limit before the user could
 * compare two tokens.
 */
export class CoinGeckoMarketClient {
  readonly #baseUrl: string
  readonly #apiKey: string | null
  readonly #timeoutMs: number
  readonly #perPage: number
  readonly #fetch: typeof fetch

  constructor(options: ICoinGeckoMarketClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#apiKey = options.apiKey ?? null
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#perPage = options.perPage ?? DEFAULT_PER_PAGE
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async getMarkets(signal?: AbortSignal): Promise<readonly IMarketCoin[]> {
    const url = new URL(`${this.#baseUrl}/coins/markets`)

    url.searchParams.set('vs_currency', 'usd')
    url.searchParams.set('order', 'market_cap_desc')
    url.searchParams.set('per_page', String(this.#perPage))
    url.searchParams.set('page', '1')
    url.searchParams.set('sparkline', 'true')
    url.searchParams.set('price_change_percentage', '1h,24h,7d')

    const payload = await this.#request(url, signal)

    return parseMarketList(payload)
  }

  async #request(url: URL, externalSignal?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' }

    if (this.#apiKey !== null) {
      headers['x-cg-demo-api-key'] = this.#apiKey
    }

    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal =
      externalSignal === undefined ? timeout : AbortSignal.any([timeout, externalSignal])

    const response = await this.#fetch(url.toString(), {
      headers,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      throw new Error(`The price source responded with ${String(response.status)}.`)
    }

    const payload: unknown = await response.json()

    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>

      if (record['error_code'] !== undefined || record['status'] !== undefined) {
        throw new Error(readErrorMessage(record))
      }
    }

    return payload
  }
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
