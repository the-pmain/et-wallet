import { describe, expect, it } from 'vitest'

import { TtlCache } from './ttl-cache.ts'

describe('TtlCache', () => {
  it('loads once while the ttl holds, then again after expiry', async () => {
    let now = 1_000
    let loads = 0
    const cache = new TtlCache<string>({ now: () => now, ttlMs: 50 })

    const first = await cache.get(async () => {
      loads += 1

      return 'a'
    })
    const second = await cache.get(async () => {
      loads += 1

      return 'b'
    })

    now = 1_060
    const third = await cache.get(async () => {
      loads += 1

      return 'c'
    })

    expect(first).toBe('a')
    expect(second).toBe('a')
    expect(third).toBe('c')
    expect(loads).toBe(2)
  })

  it('shares one in-flight load and does not store a failure', async () => {
    let loads = 0
    const cache = new TtlCache<string>({ ttlMs: 1_000 })

    const pending = cache.get(async () => {
      loads += 1
      await Promise.resolve()

      return 'ok'
    })

    await expect(
      Promise.all([
        pending,
        cache.get(async () => {
          loads += 1

          return 'other'
        }),
      ]),
    ).resolves.toEqual(['ok', 'ok'])

    await expect(
      cache.get(async () => {
        throw new Error('nope')
      }),
    ).resolves.toBe('ok')

    cache.invalidate()

    await expect(
      cache.get(async () => {
        loads += 1
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')

    const recovered = await cache.get(async () => {
      loads += 1

      return 'fresh'
    })

    expect(recovered).toBe('fresh')
    expect(loads).toBe(3)
    expect(cache.peek()).toBe('fresh')
  })
})
