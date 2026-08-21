/**
 * Курс ETH/USD для стартовой витрины.
 *
 * Несколько публичных источников: CoinGecko бесплатный тариф часто
 * отвечает 429, и тогда сумма схлопывалась бы в пыль. Coinbase spot
 * не требует ключа и отдаёт одну пару ETH-USD.
 */

const COINBASE_SPOT_URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot'
const BINANCE_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT'
const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price'
const REQUEST_TIMEOUT_MS = 10_000

/** Если источники не ответили: 0.1 ETH на $250. */
export const FALLBACK_ETH_USD = 2500

/** Сколько долларов кладём нативной валютой при создании записи. */
export const STARTING_ETH_USD = 250

const CENTS = 100
const WEI_PER_ETH = 10n ** 18n
const MIN_VALUE_CENTS = 200n * BigInt(CENTS)
const MAX_VALUE_CENTS = 300n * BigInt(CENTS)

/**
 * Минимальные единицы актива на заданную сумму.
 *
 * Сумма и цена — в центах, деление на `bigint`: `Number(wei)` на 18
 * знаках уже неточный.
 */
export function weiForUsd(usd: number, unitPriceUsd: number, decimals: number): bigint {
  if (!(usd > 0) || !(unitPriceUsd > 0) || !Number.isInteger(decimals) || decimals < 0) {
    return 0n
  }

  const usdCents = BigInt(Math.round(usd * CENTS))
  const priceCents = BigInt(Math.round(unitPriceUsd * CENTS))

  if (usdCents === 0n || priceCents === 0n) {
    return 0n
  }

  return (usdCents * 10n ** BigInt(decimals)) / priceCents
}

/** Wei эфира на `STARTING_ETH_USD`. Если оценка уехала — запасной курс. */
export function startingEthWei(ethUsd: number): bigint {
  const wei = weiForUsd(STARTING_ETH_USD, ethUsd, 18)
  const priceCents = BigInt(Math.round(ethUsd * CENTS))

  if (priceCents === 0n) {
    return weiForUsd(STARTING_ETH_USD, FALLBACK_ETH_USD, 18)
  }

  const valueCents = (wei * priceCents) / WEI_PER_ETH

  if (valueCents >= MIN_VALUE_CENTS && valueCents <= MAX_VALUE_CENTS) {
    return wei
  }

  return weiForUsd(STARTING_ETH_USD, FALLBACK_ETH_USD, 18)
}

/** Живой курс эфира. При отказе всех источников — `null`. */
export async function fetchEthUsd(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const fromCoinbase = await readCoinbaseSpot(fetchImpl)

  if (fromCoinbase !== null) {
    return fromCoinbase
  }

  const fromBinance = await readBinancePrice(fetchImpl)

  if (fromBinance !== null) {
    return fromBinance
  }

  return await readCoinGeckoPrice(fetchImpl)
}

/** Курс для расчёта стартового ETH: живой, иначе запасной. */
export async function readEthUsd(fetchImpl: typeof fetch = fetch): Promise<number> {
  return (await fetchEthUsd(fetchImpl)) ?? FALLBACK_ETH_USD
}

async function readCoinbaseSpot(fetchImpl: typeof fetch): Promise<number | null> {
  const payload = await getJson(fetchImpl, COINBASE_SPOT_URL)

  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const data = (payload as Record<string, unknown>)['data']

  if (data === null || typeof data !== 'object') {
    return null
  }

  return readPositiveNumber((data as Record<string, unknown>)['amount'])
}

async function readBinancePrice(fetchImpl: typeof fetch): Promise<number | null> {
  const payload = await getJson(fetchImpl, BINANCE_PRICE_URL)

  if (payload === null || typeof payload !== 'object') {
    return null
  }

  return readPositiveNumber((payload as Record<string, unknown>)['price'])
}

async function readCoinGeckoPrice(fetchImpl: typeof fetch): Promise<number | null> {
  const url = new URL(COINGECKO_PRICE_URL)

  url.searchParams.set('ids', 'ethereum')
  url.searchParams.set('vs_currencies', 'usd')

  const payload = await getJson(fetchImpl, url.toString())

  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const ethereum = (payload as Record<string, unknown>)['ethereum']

  if (ethereum === null || typeof ethereum !== 'object') {
    return null
  }

  return readPositiveNumber((ethereum as Record<string, unknown>)['usd'])
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}
