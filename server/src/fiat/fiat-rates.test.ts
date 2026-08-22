import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchFiatRates, resetFiatRatesCacheForTests } from './fiat-rates.ts'

afterEach(() => {
  resetFiatRatesCacheForTests()
})

describe('fetchFiatRates', () => {
  it('читает EUR и GBP к доллару', async () => {
    const fetchImpl = vi.fn((url: string) => {
      expect(url).toContain('frankfurter')

      return Promise.resolve(
        new Response(JSON.stringify({ rates: { EUR: 0.9, GBP: 0.8 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    await expect(fetchFiatRates(fetchImpl)).resolves.toEqual({ EUR: 0.9, GBP: 0.8 })
  })

  it('переходит ко второму источнику, если первый отказал', async () => {
    let calls = 0
    const fetchImpl = vi.fn(() => {
      calls += 1

      if (calls === 1) {
        return Promise.resolve(new Response('{}', { status: 502 }))
      }

      return Promise.resolve(
        new Response(JSON.stringify({ rates: { EUR: 0.92, GBP: 0.78 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    await expect(fetchFiatRates(fetchImpl)).resolves.toEqual({ EUR: 0.92, GBP: 0.78 })
    expect(calls).toBe(2)
  })
})
