/**
 * Price series for an asset chart.
 *
 * THE CATALOG SPARKLINE IS THE BASE. It arrives with `/coins/markets`
 * and costs no extra request. Coinbase candles are a refinement while
 * the panel is open: a different source, its own limit, and the
 * portfolio is not in the request — only a public pair such as
 * ETH-USD.
 */

export const CHART_RANGE = {
  Hours24: '24h',
  Days7: '7d',
} as const

export type ChartRange = (typeof CHART_RANGE)[keyof typeof CHART_RANGE]

/** One point of the series. Time is Unix milliseconds. */
export interface IPricePoint {
  readonly at: number
  readonly price: number
}

export interface IFetchCandleOptions {
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
  readonly now?: number
}

const COINBASE_CANDLES_URL = 'https://api.exchange.coinbase.com/products'
const REQUEST_TIMEOUT_MS = 10_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * Coinbase pair by catalog coin id.
 *
 * No pair — no candles. Substituting a similar one would draw someone
 * else's chart: WBTC is not ETH, even if both are "crypto".
 */
const PRODUCT_BY_COIN_ID: ReadonlyMap<string, string> = new Map([
  ['ethereum', 'ETH-USD'],
  ['weth', 'ETH-USD'],
  ['bitcoin', 'BTC-USD'],
  ['wrapped-bitcoin', 'BTC-USD'],
  ['usd-coin', 'USDC-USD'],
  ['tether', 'USDT-USD'],
  ['dai', 'DAI-USD'],
  ['binancecoin', 'BNB-USD'],
  ['avalanche-2', 'AVAX-USD'],
  ['polygon-ecosystem-token', 'POL-USD'],
])

export function coinbaseProductForCoinId(coinId: string): string | null {
  return PRODUCT_BY_COIN_ID.get(coinId) ?? null
}

/**
 * Puts hourly timestamps on a CoinGecko series.
 *
 * The source returns prices only. Seven days by the hour is the
 * contract of their `sparkline_in_7d`, not our guess at an arbitrary
 * step.
 */
export function pointsFromSparkline(
  prices: readonly number[],
  now: number = Date.now(),
): readonly IPricePoint[] {
  if (prices.length < 2) {
    return []
  }

  const lastIndex = prices.length - 1

  return prices.map((price, index) => ({
    at: now - (lastIndex - index) * HOUR_MS,
    price,
  }))
}

/** Keeps points of the chosen window. An empty series is not padded. */
export function slicePointsForRange(
  points: readonly IPricePoint[],
  range: ChartRange,
  now: number = Date.now(),
): readonly IPricePoint[] {
  if (points.length < 2) {
    return []
  }

  const from = now - (range === CHART_RANGE.Hours24 ? DAY_MS : 7 * DAY_MS)
  const sliced = points.filter((point) => point.at >= from)

  return sliced.length >= 2 ? sliced : points
}

/**
 * Appends the current price to the tail.
 *
 * Without this the catalog chart stands still until Coinbase answers:
 * the last sparkline point may be an hour old, and the rate on the
 * row is one just received.
 */
export function mergeLivePrice(
  points: readonly IPricePoint[],
  price: number,
  at: number = Date.now(),
): readonly IPricePoint[] {
  if (!Number.isFinite(price) || price <= 0) {
    return points
  }

  const last = points[points.length - 1]

  if (last === undefined) {
    return points
  }

  if (at <= last.at) {
    return [...points.slice(0, -1), { at: last.at, price }]
  }

  return [...points, { at, price }]
}

/**
 * Coinbase candles for the chart window.
 *
 * `[]` — the pair is unknown to the source, the response is broken,
 * or the network did not answer. An empty series is not a screen
 * error: the catalog sparkline remains.
 */
export async function fetchCoinbaseCandlePoints(
  product: string,
  range: ChartRange,
  options: IFetchCandleOptions = {},
): Promise<readonly IPricePoint[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now()
  const windowMs = range === CHART_RANGE.Hours24 ? DAY_MS : 7 * DAY_MS
  const granularity = range === CHART_RANGE.Hours24 ? 300 : 3600
  const url = new URL(`${COINBASE_CANDLES_URL}/${product}/candles`)

  url.searchParams.set('granularity', String(granularity))
  url.searchParams.set('start', new Date(now - windowMs).toISOString())
  url.searchParams.set('end', new Date(now).toISOString())

  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])

    const response = await fetchImpl(url.toString(), {
      headers: { accept: 'application/json' },
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      return []
    }

    return parseCoinbaseCandles(await response.json())
  } catch {
    return []
  }
}

/**
 * Parses an array `[time, low, high, open, close, volume]`.
 *
 * The source returns candles from newest to oldest. The chart reads
 * left to right, so the series is reversed. Close is taken: high/low
 * are indistinguishable on a narrow line and would create a false
 * range.
 */
export function parseCoinbaseCandles(payload: unknown): readonly IPricePoint[] {
  if (!Array.isArray(payload)) {
    return []
  }

  const points: IPricePoint[] = []

  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 5) {
      continue
    }

    const time = row[0]
    const close = row[4]
    const at = typeof time === 'number' ? time * 1000 : Number.NaN
    const price = typeof close === 'number' ? close : Number(close)

    if (!Number.isFinite(at) || !Number.isFinite(price) || price <= 0) {
      continue
    }

    points.push({ at, price })
  }

  points.sort((left, right) => left.at - right.at)

  return points.length >= 2 ? points : []
}
