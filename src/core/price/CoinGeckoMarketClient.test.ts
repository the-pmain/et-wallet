import { beforeEach, describe, expect, it } from 'vitest'

import { CoinGeckoMarketClient } from './CoinGeckoMarketClient'

let requested: string[]
let responder: (url: string) => { status: number; body: unknown }

function createClient() {
  return new CoinGeckoMarketClient({
    baseUrl: 'https://prices.test/api/v3',
    fetchImpl: ((input: string) => {
      requested.push(input)

      const { status, body } = responder(input)

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as typeof fetch,
  })
}

beforeEach(() => {
  requested = []
  responder = () => ({ status: 200, body: [] })
})

describe('CoinGeckoMarketClient', () => {
  it('запрашивает рынок без графика за семь дней', async () => {
    responder = () => ({
      status: 200,
      body: [
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          current_price: 71_947,
          market_cap_rank: 1,
        },
      ],
    })

    const coins = await createClient().getMarkets()
    const url = new URL(requested[0] ?? '')

    expect(url.pathname).toBe('/api/v3/coins/markets')
    expect(url.searchParams.get('vs_currency')).toBe('usd')
    expect(url.searchParams.get('order')).toBe('market_cap_desc')
    expect(url.searchParams.get('per_page')).toBe('50')
    expect(url.searchParams.get('sparkline')).toBe('false')
    expect(url.searchParams.get('price_change_percentage')).toBe('1h,24h,7d')
    expect(coins).toHaveLength(1)
    expect(coins[0]?.name).toBe('Bitcoin')
  })

  it('не подставляет ключ, которого нет', async () => {
    await createClient().getMarkets()

    expect(requested).toHaveLength(1)
  })

  it('передаёт ключ демо-доступа заголовком', async () => {
    const headers: string[] = []
    const client = new CoinGeckoMarketClient({
      baseUrl: 'https://prices.test/api/v3',
      apiKey: 'demo-key',
      fetchImpl: ((input: string, init?: RequestInit) => {
        requested.push(input)
        headers.push(new Headers(init?.headers).get('x-cg-demo-api-key') ?? '')

        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
        )
      }) as typeof fetch,
    })

    await client.getMarkets()

    expect(headers).toEqual(['demo-key'])
  })

  it('называет отказ сервиса, а не прячет его пустым списком', async () => {
    responder = () => ({
      status: 200,
      body: { status: { error_code: 429, error_message: 'Rate limit exceeded.' } },
    })

    await expect(createClient().getMarkets()).rejects.toThrow('Rate limit exceeded.')
  })

  it('не принимает код ответа вне 2xx за успех', async () => {
    responder = () => ({ status: 502, body: [] })

    await expect(createClient().getMarkets()).rejects.toThrow(
      'The price source responded with 502.',
    )
  })
})
