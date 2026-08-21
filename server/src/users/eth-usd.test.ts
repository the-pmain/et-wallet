import { describe, expect, it, vi } from 'vitest'

import { FALLBACK_ETH_USD, fetchEthUsd, readEthUsd, weiForUsd } from './eth-usd.ts'

describe('weiForUsd', () => {
  it('при курсе 2500 даёт ровно 0.1 ETH на $250', () => {
    expect(weiForUsd(250, 2500, 18)).toBe(100000000000000000n)
  })

  it('при курсе 2000 даёт 0.125 ETH на $250', () => {
    expect(weiForUsd(250, 2000, 18)).toBe(125000000000000000n)
  })

  it('при курсе 6100 даёт около 0.041 ETH, а не 0.00041', () => {
    const wei = weiForUsd(250, 6100, 18)

    expect(wei).toBe(40983606557377049n)
    expect(wei > 10n ** 16n).toBe(true)
  })

  it('нулевая или отрицательная цена не чеканит эфир', () => {
    expect(weiForUsd(250, 0, 18)).toBe(0n)
    expect(weiForUsd(250, -1, 18)).toBe(0n)
  })
})

describe('fetchEthUsd', () => {
  it('читает курс Coinbase', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { amount: '3284.12' } }),
    })

    await expect(fetchEthUsd(fetchImpl as unknown as typeof fetch)).resolves.toBe(3284.12)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('ETH-USD/spot')
  })

  it('если Coinbase молчит, берёт Binance', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('coinbase')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ symbol: 'ETHUSDT', price: '2000.00' }),
      })
    })

    await expect(fetchEthUsd(fetchImpl as unknown as typeof fetch)).resolves.toBe(2000)
  })

  it('при отказе источника подставляет запасной курс', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(readEthUsd(fetchImpl as unknown as typeof fetch)).resolves.toBe(FALLBACK_ETH_USD)
  })
})
