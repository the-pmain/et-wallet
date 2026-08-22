const FRANKFURTER_SOURCES = [
  'https://api.frankfurter.app/v1/latest?from=USD&to=EUR,GBP',
  'https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP',
] as const

const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60 * 60 * 1000

export interface IFiatRatesPayload {
  readonly EUR: number
  readonly GBP: number
}

let cached: { readonly rates: IFiatRatesPayload; readonly expiresAt: number } | null = null

/** Курсы EUR и GBP к одному USD. Кэш на час — ЕЦБ обновляет реже. */
export async function fetchFiatRates(fetchImpl: typeof fetch = fetch): Promise<IFiatRatesPayload> {
  if (cached !== null && Date.now() < cached.expiresAt) {
    return cached.rates
  }

  let lastError: unknown = null

  for (const url of FRANKFURTER_SOURCES) {
    try {
      const rates = await readFrankfurter(url, fetchImpl)
      cached = { rates, expiresAt: Date.now() + CACHE_TTL_MS }

      return rates
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('The exchange-rate source did not respond.')
}

function readFrankfurter(url: string, fetchImpl: typeof fetch): Promise<IFiatRatesPayload> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  return fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: controller.signal,
    credentials: 'omit',
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`The exchange-rate source responded with ${String(response.status)}.`)
      }

      return readRates(await response.json())
    })
    .finally(() => {
      clearTimeout(timeoutId)
    })
}

function readRates(payload: unknown): IFiatRatesPayload {
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

/** Сброс кэша — только для тестов. */
export function resetFiatRatesCacheForTests(): void {
  cached = null
}
