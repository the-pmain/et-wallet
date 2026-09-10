import { beforeEach, describe, expect, it } from 'vitest'

import { FiatRatesClient } from './FiatRatesClient'

const PRIMARY = 'https://fx.test/primary'
const FALLBACK = 'https://fx.test/fallback?from=USD&to=EUR,GBP'

let requested: string[]
let responder: (url: string) => { status: number; body: unknown }

function createClient() {
  return new FiatRatesClient({
    sources: [PRIMARY, FALLBACK],
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
  it('читает евро и фунты к доллару', async () => {
    const rates = await createClient().getRates()

    expect(requested[0]).toBe(PRIMARY)
    expect(rates).toEqual({ EUR: 0.9, GBP: 0.8 })
  })

  it('переходит к запасному источнику после отказа', async () => {
    responder = (url) =>
      url === PRIMARY
        ? { status: 502, body: {} }
        : { status: 200, body: { rates: { EUR: 0.92, GBP: 0.78 } } }

    await expect(createClient().getRates()).resolves.toEqual({ EUR: 0.92, GBP: 0.78 })
    expect(requested).toEqual([PRIMARY, FALLBACK])
  })

  it('не принимает отказ всех источников за курс 1:1', async () => {
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
