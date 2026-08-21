const DEFAULT_BASE_URL = 'https://api.frankfurter.dev'
const DEFAULT_TIMEOUT_MS = 10_000

/** Курсы к доллару. */
export interface IFetchedFiatRates {
  readonly EUR: number
  readonly GBP: number
}

export interface IFiatRatesClientOptions {
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

/**
 * Курсы фиатных валют к доллару.
 *
 * ИСТОЧНИК — ЕЦБ через Frankfurter, а не оценка криптовалюты.
 * Нужны только EUR и GBP: канонический баланс справочника в долларах.
 */
export class FiatRatesClient {
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: IFiatRatesClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async getRates(signal?: AbortSignal): Promise<IFetchedFiatRates> {
    const url = new URL(`${this.#baseUrl}/latest`)

    url.searchParams.set('from', 'USD')
    url.searchParams.set('to', 'EUR,GBP')

    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal])

    const response = await this.#fetch(url.toString(), {
      headers: { accept: 'application/json' },
      signal: combined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      throw new Error(`The exchange-rate source responded with ${String(response.status)}.`)
    }

    return readRates(await response.json())
  }
}

function readRates(payload: unknown): IFetchedFiatRates {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('The exchange-rate source returned an unexpected response.')
  }

  const rates = (payload as Record<string, unknown>)['rates']

  if (typeof rates !== 'object' || rates === null) {
    throw new Error('The exchange-rate source returned an unexpected response.')
  }

  const record = rates as Record<string, unknown>
  const eur = record['EUR']
  const gbp = record['GBP']

  if (typeof eur !== 'number' || !Number.isFinite(eur) || eur <= 0) {
    throw new Error('The exchange-rate source returned an unexpected response.')
  }

  if (typeof gbp !== 'number' || !Number.isFinite(gbp) || gbp <= 0) {
    throw new Error('The exchange-rate source returned an unexpected response.')
  }

  return { EUR: eur, GBP: gbp }
}
