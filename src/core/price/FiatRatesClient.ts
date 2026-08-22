const DEFAULT_TIMEOUT_MS = 10_000

const DIRECT_SOURCES = [
  'https://api.frankfurter.app/v1/latest?from=USD&to=EUR,GBP',
  'https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP',
] as const

/** Курсы к доллару. */
export interface IFetchedFiatRates {
  readonly EUR: number
  readonly GBP: number
}

export interface IFiatRatesClientOptions {
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
  /** Полные URL источников. По умолчанию — `/v1/fiat-rates`, затем Frankfurter. */
  readonly sources?: readonly string[]
}

/**
 * Курсы фиатных валют к доллару.
 *
 * Сначала спрашивает свой сервер (`/v1/fiat-rates`), затем Frankfurter
 * напрямую. Так курсы работают и в dev через прокси Vite, и в сборке
 * с одного origin, и без сервера — по запасным адресам ECB.
 */
export class FiatRatesClient {
  readonly #sources: readonly string[]
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: IFiatRatesClientOptions = {}) {
    this.#sources = options.sources ?? defaultSources()
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async getRates(signal?: AbortSignal): Promise<IFetchedFiatRates> {
    let lastError: unknown = null

    for (const source of this.#sources) {
      try {
        return await this.#fetchSource(source, signal)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The exchange-rate source did not respond.')
  }

  async #fetchSource(source: string, signal?: AbortSignal): Promise<IFetchedFiatRates> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, this.#timeoutMs)

    const onExternalAbort = () => {
      controller.abort()
    }

    if (signal !== undefined) {
      if (signal.aborted) {
        clearTimeout(timeoutId)
        throw new DOMException('The request was aborted.', 'AbortError')
      }

      signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const response = await this.#fetch(source, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })

      if (!response.ok) {
        throw new Error(`The exchange-rate source responded with ${String(response.status)}.`)
      }

      return readRates(await response.json())
    } finally {
      clearTimeout(timeoutId)

      if (signal !== undefined) {
        signal.removeEventListener('abort', onExternalAbort)
      }
    }
  }
}

function defaultSources(): readonly string[] {
  const sources: string[] = []

  if (typeof window !== 'undefined' && window.location.origin !== 'null') {
    sources.push(new URL('/v1/fiat-rates', window.location.origin).href)
  }

  sources.push(...DIRECT_SOURCES)

  return sources
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
