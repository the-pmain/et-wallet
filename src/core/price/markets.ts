/**
 * Public-market snapshot.
 *
 * THIS IS NOT A PORTFOLIO RATE. The list contains neither the owner's
 * addresses nor their contract addresses: the service learns only the
 * IP and that someone looked at a public table. So the request does
 * not need the consent taken on the portfolio screen — there, asset
 * addresses go in the request.
 *
 * AN IMAGE FROM THE RESPONSE DOES NOT LAND HERE. The production CSP
 * allows images only from the own build; a foreign URL in `src`
 * would be blocked, and the set of requested pictures would tell the
 * storage operator which coins were viewed. Marks, if needed, come
 * from bundled files.
 */
export interface IMarketCoin {
  readonly id: string
  readonly symbol: string
  readonly name: string
  readonly rank: number
  readonly priceUsd: number | null
  readonly change1hPercent: number | null
  readonly change24hPercent: number | null
  readonly change7dPercent: number | null
  readonly volume24hUsd: number | null
  readonly marketCapUsd: number | null

  /**
   * Seven-day price series from the same `/coins/markets`.
   *
   * A separate `market_chart` is not requested: the free CoinGecko
   * limit runs out on a few calls, and this series already arrives
   * with the table. `null` — there was no source, or too few points
   * to draw a line.
   */
  readonly sparkline7d: readonly number[] | null
}

/**
 * Parses a `/coins/markets` response.
 *
 * A RECORD WITHOUT A NAME IS DROPPED, NOT REPAIRED. Substituting a
 * dash for a name would show a row that cannot be identified. A
 * broken record among fifty does not cancel the rest: one hole in
 * the response is not a reason to hide the whole market.
 */
export function parseMarketList(payload: unknown): readonly IMarketCoin[] {
  if (!Array.isArray(payload)) {
    throw new Error('The price source returned an unexpected response.')
  }

  const coins: IMarketCoin[] = []

  for (const [index, entry] of payload.entries()) {
    const coin = readMarketCoin(entry, index)

    if (coin !== null) {
      coins.push(coin)
    }
  }

  return coins
}

/** Builds one market row. `null` — the record cannot be shown. */
function readMarketCoin(entry: unknown, index: number): IMarketCoin | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const record = entry as Record<string, unknown>
  const id = readRequiredString(record['id'])
  const name = readRequiredString(record['name'])
  const symbol = readRequiredString(record['symbol'])

  if (id === null || name === null || symbol === null) {
    return null
  }

  const rank = readRank(record['market_cap_rank'], index)

  return {
    id,
    name,
    symbol: symbol.toUpperCase(),
    rank,
    priceUsd: readNumber(record['current_price']),
    change1hPercent: readNumber(record['price_change_percentage_1h_in_currency']),
    change24hPercent: readNumber(record['price_change_percentage_24h_in_currency']),
    change7dPercent: readNumber(record['price_change_percentage_7d_in_currency']),
    volume24hUsd: readNumber(record['total_volume']),
    marketCapUsd: readNumber(record['market_cap']),
    sparkline7d: readSparkline(record['sparkline_in_7d']),
  }
}

/**
 * Series from `sparkline_in_7d.price`. Fewer than two points is not
 * a series: a chart will not draw one point, and a fake empty line
 * is not allowed.
 */
function readSparkline(value: unknown): readonly number[] | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const prices = (value as Record<string, unknown>)['price']

  if (!Array.isArray(prices)) {
    return null
  }

  const points: number[] = []

  for (const price of prices) {
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      points.push(price)
    }
  }

  return points.length >= 2 ? points : null
}

/** Positive rank from the response, otherwise the ordinal in the list. */
function readRank(value: unknown, index: number): number {
  const rank = readNumber(value)

  if (rank === null || rank <= 0) {
    return index + 1
  }

  return Math.trunc(rank)
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

/**
 * A finite number or `null`.
 *
 * Zero is left as zero: a 0.0 % change on a stablecoin is a real
 * value, not a hole. A non-number and infinity are a hole.
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
