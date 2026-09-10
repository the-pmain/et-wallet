import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FiatRatesClient } from '@/core'
import { mockDirectoryAndPriceFetch } from '@/test/doubles'

import { FiatRatesCache } from './fiat-rates-cache'

describe('FiatRatesCache', () => {
  beforeEach(() => {
    globalThis.fetch = mockDirectoryAndPriceFetch({ id: '1' })
  })

  it('loads rates from Frankfurter v1', async () => {
    const cache = new FiatRatesCache(
      new FiatRatesClient({
        sources: ['https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP'],
      }),
    )

    await cache.ensureLoaded()

    expect(cache.getSnapshot()).toEqual({ USD: 1, EUR: 0.92, GBP: 0.78 })
  })

  it('does not repeat the request on a second ensureLoaded', async () => {
    const fetchMock = mockDirectoryAndPriceFetch({ id: '1' })
    globalThis.fetch = fetchMock
    const cache = new FiatRatesCache(
      new FiatRatesClient({
        sources: ['https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP'],
      }),
    )

    await cache.ensureLoaded()
    await cache.ensureLoaded()

    const frankfurterCalls = vi
      .mocked(fetchMock)
      .mock.calls.filter((call) => String(call[0]).includes('frankfurter.dev'))

    expect(frankfurterCalls).toHaveLength(1)
  })
})
