import { beforeEach, describe, expect, it } from 'vitest'

import { FiatRatesClient } from './FiatRatesClient'

let requested: string[]
let responder: (url: string) => { status: number; body: unknown }

function createClient() {
  return new FiatRatesClient({
    baseUrl: 'https://fx.test',
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
  responder = () => ({ status: 200, body: { rates: { EUR: 0.9, GBP: 0.8 } } })
})

describe('FiatRatesClient', () => {
  it('спрашивает евро и фунты к доллару', async () => {
    const rates = await createClient().getRates()
    const url = new URL(requested[0] ?? '')

    expect(url.pathname).toBe('/latest')
    expect(url.searchParams.get('from')).toBe('USD')
    expect(url.searchParams.get('to')).toBe('EUR,GBP')
    expect(rates).toEqual({ EUR: 0.9, GBP: 0.8 })
  })

  it('не принимает отказ источника за курс 1:1', async () => {
    responder = () => ({ status: 502, body: {} })

    await expect(createClient().getRates()).rejects.toThrow(
      'The exchange-rate source responded with 502.',
    )
  })

  it('не подставляет ноль, когда поле курса отсутствует', async () => {
    responder = () => ({ status: 200, body: { rates: { EUR: 0.9 } } })

    await expect(createClient().getRates()).rejects.toThrow(
      'The exchange-rate source returned an unexpected response.',
    )
  })
})
