import { describe, expect, it, vi } from 'vitest'

import { FALLBACK_ETH_USD, fetchEthUsd, readEthUsd, weiForUsd } from './eth-usd.ts'

describe('weiForUsd', () => {
  it('at rate 2500 gives exactly 0.1 ETH for $250', () => {
    expect(weiForUsd(250, 2500, 18)).toBe(100000000000000000n)
  })

  it('at rate 2000 gives 0.125 ETH for $250', () => {
    expect(weiForUsd(250, 2000, 18)).toBe(125000000000000000n)
  })

  it('at rate 6100 gives about 0.041 ETH, not 0.00041', () => {
    const wei = weiForUsd(250, 6100, 18)

    expect(wei).toBe(40983606557377049n)
    expect(wei > 10n ** 16n).toBe(true)
  })

  it('a zero or negative price does not mint ether', () => {
    expect(weiForUsd(250, 0, 18)).toBe(0n)
    expect(weiForUsd(250, -1, 18)).toBe(0n)
  })
})

describe('fetchEthUsd', () => {
  it('reads the Coinbase rate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { amount: '3284.12' } }),
    })

    await expect(fetchEthUsd(fetchImpl as unknown as typeof fetch)).resolves.toBe(3284.12)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('ETH-USD/spot')
  })

  it('if Coinbase is silent, takes Binance', async () => {
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

  it('on source failure substitutes the fallback rate', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(readEthUsd(fetchImpl as unknown as typeof fetch)).resolves.toBe(FALLBACK_ETH_USD)
  })
})
