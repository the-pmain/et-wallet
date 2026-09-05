import { describe, expect, it } from 'vitest'

import {
  CHART_RANGE,
  coinbaseProductForCoinId,
  fetchCoinbaseCandlePoints,
  mergeLivePrice,
  parseCoinbaseCandles,
  pointsFromSparkline,
  slicePointsForRange,
} from './price-series'

const HOUR = 3_600_000

describe('price-series', () => {
  it('puts hourly timestamps on a sparkline', () => {
    const now = 1_000_000
    const points = pointsFromSparkline([10, 11, 12], now)

    expect(points).toEqual([
      { at: now - 2 * HOUR, price: 10 },
      { at: now - HOUR, price: 11 },
      { at: now, price: 12 },
    ])
  })

  it('for a day keeps the tail of the series', () => {
    const now = 30 * HOUR
    const points = [
      { at: 0, price: 1 },
      { at: 10 * HOUR, price: 2 },
      { at: 23 * HOUR, price: 3 },
      { at: 30 * HOUR, price: 4 },
    ]

    expect(slicePointsForRange(points, CHART_RANGE.Hours24, now).map((point) => point.price)).toEqual([
      2, 3, 4,
    ])
  })

  it('appends the live price to the tail, not in place of the middle', () => {
    const points = [
      { at: 1, price: 10 },
      { at: 2, price: 11 },
    ]

    expect(mergeLivePrice(points, 12, 3)).toEqual([
      { at: 1, price: 10 },
      { at: 2, price: 11 },
      { at: 3, price: 12 },
    ])
    expect(mergeLivePrice(points, 9, 2)).toEqual([
      { at: 1, price: 10 },
      { at: 2, price: 9 },
    ])
  })

  it('parses Coinbase candles from newest to oldest', () => {
    const points = parseCoinbaseCandles([
      [200, 1, 3, 2, 2.5, 10],
      [100, 1, 3, 2, 2.2, 10],
    ])

    expect(points.map((point) => point.price)).toEqual([2.2, 2.5])
    expect(points[0]?.at).toBe(100_000)
  })

  it('does not draw a foreign pair if the coin is not in the table', () => {
    expect(coinbaseProductForCoinId('ethereum')).toBe('ETH-USD')
    expect(coinbaseProductForCoinId('unknown-meme')).toBeNull()
  })

  it('on candle failure returns an empty series instead of throwing', async () => {
    const points = await fetchCoinbaseCandlePoints('ETH-USD', CHART_RANGE.Hours24, {
      fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
    })

    expect(points).toEqual([])
  })
})
