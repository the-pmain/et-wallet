import { describe, expect, it } from 'vitest'

import { parseMarketList } from './markets'

const BITCOIN = {
  id: 'bitcoin',
  symbol: 'btc',
  name: 'Bitcoin',
  current_price: 71_947.59,
  market_cap: 1_444_080_308_589,
  market_cap_rank: 1,
  total_volume: 66_443_997_085,
  price_change_percentage_1h_in_currency: 0.0,
  price_change_percentage_24h_in_currency: 11.5,
  price_change_percentage_7d_in_currency: 13.4,
  image: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
}

describe('parseMarketList', () => {
  it('takes table fields and drops the picture', () => {
    const [coin] = parseMarketList([BITCOIN])

    expect(coin).toEqual({
      id: 'bitcoin',
      symbol: 'BTC',
      name: 'Bitcoin',
      rank: 1,
      priceUsd: 71_947.59,
      change1hPercent: 0.0,
      change24hPercent: 11.5,
      change7dPercent: 13.4,
      volume24hUsd: 66_443_997_085,
      marketCapUsd: 1_444_080_308_589,
      sparkline7d: null,
    })
    expect(coin).not.toHaveProperty('image')
  })

  it('skips a broken record and keeps the neighbours', () => {
    const coins = parseMarketList([
      BITCOIN,
      { id: 1, name: 'Broken' },
      {
        id: 'ethereum',
        symbol: 'eth',
        name: 'Ethereum',
        current_price: 2289.53,
        market_cap_rank: 2,
      },
    ])

    expect(coins.map((coin) => coin.id)).toEqual(['bitcoin', 'ethereum'])
    expect(coins[1]?.priceUsd).toBe(2289.53)
    expect(coins[1]?.change1hPercent).toBeNull()
  })

  it('assigns an ordinal if there is no rank', () => {
    const coins = parseMarketList([
      { id: 'a', symbol: 'a', name: 'A' },
      { id: 'b', symbol: 'b', name: 'B', market_cap_rank: -1 },
    ])

    expect(coins.map((coin) => coin.rank)).toEqual([1, 2])
  })

  it('takes the seven-day series and drops a short one', () => {
    const [withLine, withoutLine] = parseMarketList([
      {
        ...BITCOIN,
        sparkline_in_7d: { price: [1, 2, 3] },
      },
      {
        ...BITCOIN,
        id: 'tiny',
        sparkline_in_7d: { price: [1] },
      },
    ])

    expect(withLine?.sparkline7d).toEqual([1, 2, 3])
    expect(withoutLine?.sparkline7d).toBeNull()
  })

  it('rejects a response that is not a list', () => {
    expect(() => parseMarketList({ error_code: 10010 })).toThrow(
      'The price source returned an unexpected response.',
    )
  })
})
