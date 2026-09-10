const COINBASE_SPOT_URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Курс ETH/USD с Coinbase.
 *
 * Запасной источник, если единственный запрос к CoinGecko не прошёл:
 * бесплатный лимит там кончается на нескольких обращениях подряд.
 */
export async function fetchCoinbaseEthUsd(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<number | null> {
  try {
    const response = await fetchImpl(COINBASE_SPOT_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      return null
    }

    const payload: unknown = await response.json()

    if (payload === null || typeof payload !== 'object') {
      return null
    }

    const data = (payload as Record<string, unknown>)['data']

    if (data === null || typeof data !== 'object') {
      return null
    }

    const amount = (data as Record<string, unknown>)['amount']

    if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
      return amount
    }

    if (typeof amount === 'string') {
      const parsed = Number(amount)

      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }

    return null
  } catch {
    return null
  }
}
