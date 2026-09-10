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
  it('reads euros and pounds against the dollar', async () => {
    const rates = await createClient().getRates()

    expect(requested[0]).toBe(PRIMARY)
    expect(rates).toEqual({ EUR: 0.9, GBP: 0.8 })
  })

  it('moves to a fallback source after a refusal', async () => {
    responder = (url) =>
      url === PRIMARY
        ? { status: 502, body: {} }
        : { status: 200, body: { rates: { EUR: 0.92, GBP: 0.78 } } }

    await expect(createClient().getRates()).resolves.toEqual({ EUR: 0.92, GBP: 0.78 })
    expect(requested).toEqual([PRIMARY, FALLBACK])
  })

  it('does not treat a refusal of every source as a 1:1 rate', async () => {
    responder = () => ({ status: 502, body: {} })

    await expect(createClient().getRates()).rejects.toThrow(
      'The exchange-rate source responded with 502.',
    )
  })

  it('does not insert zero when the rate field is missing', async () => {
    responder = () => ({ status: 200, body: { rates: { EUR: 0.9 } } })

    await expect(createClient().getRates()).rejects.toThrow(
      'The exchange-rate source returned an unexpected response.',
    )
  })
})
