import { vi } from 'vitest'

import { appMarketCatalog, parseMarketList, type IMarketCoin } from '@/core'

const ETH_USD = 3284.12

const TOKEN_USD: Readonly<Record<string, number>> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 0.9998,
  '0x6b175474e89094c44da98b954eedeac495271d0f': 1.0001,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 64120,
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': ETH_USD,
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1,
  '0x4200000000000000000000000000000000000006': ETH_USD,
}

function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }
}

function marketPayload(): unknown {
  return [
    marketEntry('ethereum', 'eth', 'Ethereum', ETH_USD, 2),
    marketEntry('usd-coin', 'usdc', 'USD Coin', 1, 7),
    marketEntry('tether', 'usdt', 'Tether', 0.9998, 3),
    marketEntry('dai', 'dai', 'Dai', 1.0001, 18),
    marketEntry('wrapped-bitcoin', 'wbtc', 'Wrapped Bitcoin', 64120, 15),
    marketEntry('weth', 'weth', 'WETH', ETH_USD, 20),
  ]
}

function marketEntry(
  id: string,
  symbol: string,
  name: string,
  price: number,
  rank: number,
): Record<string, unknown> {
  return {
    id,
    symbol,
    name,
    market_cap_rank: rank,
    current_price: price,
    price_change_percentage_1h_in_currency: 0,
    price_change_percentage_24h_in_currency: id === 'ethereum' ? 1.84 : 0,
    price_change_percentage_7d_in_currency: 0,
    total_volume: 1,
    market_cap: 2,
  }
}

function pricePayload(url: string): unknown {
  if (url.includes('api.coinbase.com')) {
    return { data: { amount: String(ETH_USD) } }
  }

  if (url.includes('/coins/markets')) {
    return marketPayload()
  }

  if (url.includes('/simple/price')) {
    return { ethereum: { usd: ETH_USD, usd_24h_change: 1.84, last_updated_at: 1 } }
  }

  if (url.includes('/simple/token_price')) {
    const contracts = new URL(url).searchParams.get('contract_addresses') ?? ''
    const addr = contracts.split(',')[0]?.toLowerCase() ?? ''
    const usd = TOKEN_USD[addr] ?? 1

    return { [addr]: { usd, usd_24h_change: 0, last_updated_at: 1 } }
  }

  if (url.includes('frankfurter.app')) {
    return { rates: { EUR: 0.92, GBP: 0.78 } }
  }

  return []
}

function isPriceUrl(url: string): boolean {
  return (
    url.includes('api.coingecko.com') ||
    url.includes('api.coinbase.com') ||
    url.includes('frankfurter.app')
  )
}

function testMarkets(): readonly IMarketCoin[] {
  return parseMarketList(marketPayload())
}

/**
 * `fetch` для экранов справочника: запись пользователя и курсы.
 *
 * Каталог рынка заполняется сразу: тесты не ждут сеть и не поднимают
 * второй запрос к CoinGecko.
 */
export function mockDirectoryAndPriceFetch(userBody: unknown): typeof fetch {
  appMarketCatalog.hydrate(testMarkets())

  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)

    if (isPriceUrl(url)) {
      return Promise.resolve(jsonOk(pricePayload(url)))
    }

    return Promise.resolve(jsonOk(userBody))
  }) as unknown as typeof fetch
}
