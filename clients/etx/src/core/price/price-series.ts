/**
 * Ряд цен для графика актива.
 *
 * КАТАЛОЖНЫЙ SPARKLINE — ОСНОВА. Он приходит вместе с `/coins/markets`
 * и не стоит отдельного запроса. Свечи Coinbase — уточнение, пока
 * панель открыта: другой источник, свой лимит, состав портфеля
 * в запрос не входит — только общедоступная пара вроде ETH-USD.
 */

export const CHART_RANGE = {
  Hours24: '24h',
  Days7: '7d',
} as const

export type ChartRange = (typeof CHART_RANGE)[keyof typeof CHART_RANGE]

/** Одна точка ряда. Время — миллисекунды Unix. */
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
 * Пара Coinbase по идентификатору монеты каталога.
 *
 * Нет пары — нет свечей. Подставить похожую значило бы нарисовать
 * чужой график: WBTC это не ETH, даже если оба «крипта».
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
 * Ставит часовые метки на ряд CoinGecko.
 *
 * Источник отдаёт только цены. Семь дней по часу — договорённость
 * их `sparkline_in_7d`, не наша догадка о произвольном шаге.
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

/** Оставляет точки выбранного окна. Пустой ряд не дополняется. */
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
 * Дописывает текущую цену в хвост.
 *
 * Без этого график из каталога стоит, пока Coinbase не ответил:
 * последняя точка sparkline может быть часовой давности, а курс
 * на строке — только что полученный.
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
 * Свечи Coinbase за окно графика.
 *
 * `[]` — пара неизвестна источнику, ответ битый или сеть не ответила.
 * Пустой ряд не ошибка экрана: тогда остаётся sparkline каталога.
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
 * Разбирает массив `[time, low, high, open, close, volume]`.
 *
 * Источник отдаёт свечи от новых к старым. График читает слева
 * направо, поэтому ряд переворачивается. Берётся close: high/low
 * на узкой линии неразличимы и создавали бы ложный размах.
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
