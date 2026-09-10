import { beforeEach, describe, expect, it } from 'vitest'

import { TooManyAttemptsError } from '@/core/errors'
import { SETTINGS_KEY, STORAGE_NAMESPACE } from '@/core/storage'
import { FakeClock, InMemoryStorageService, NullLogger } from '@/test/doubles'

import { FREE_UNLOCK_ATTEMPTS, UnlockThrottle, delayFor } from './UnlockThrottle'

let storage: InMemoryStorageService
let clock: FakeClock
let throttle: UnlockThrottle

/** Records the given number of consecutive failures. */
async function fail(times: number): Promise<void> {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await throttle.recordFailure()
  }
}

beforeEach(() => {
  storage = new InMemoryStorageService()
  clock = new FakeClock(1_700_000_000_000)
  throttle = new UnlockThrottle({ storage, clock, logger: new NullLogger() })
})

describe('delayFor: delay table', () => {
  it('the first attempts pass with no delay', () => {
    /* Slack for a typo and a forgotten layout. */
    for (let attempt = 1; attempt <= FREE_UNLOCK_ATTEMPTS; attempt += 1) {
      expect(delayFor(attempt)).toBe(0)
    }
  })

  it('a delay appears as soon as the slack is used up', () => {
    expect(delayFor(FREE_UNLOCK_ATTEMPTS + 1)).toBeGreaterThan(0)
  })

  it('grows with each further failure', () => {
    const first = delayFor(FREE_UNLOCK_ATTEMPTS + 1)
    const second = delayFor(FREE_UNLOCK_ATTEMPTS + 2)
    const third = delayFor(FREE_UNLOCK_ATTEMPTS + 3)

    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('has a cap and does not lock the wallet forever', () => {
    /* An endlessly growing delay would mean the owner loses access
       to their own funds over a forgotten layout. */
    const cap = delayFor(100)

    expect(cap).toBe(delayFor(1000))
    expect(cap).toBeLessThanOrEqual(15 * 60_000)
  })
})

describe('UnlockThrottle: attempt counting', () => {
  it('input is open on a clean state', async () => {
    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
    await expect(throttle.getState()).resolves.toEqual({ failedAttempts: 0, retryAfterMs: 0 })
  })

  it('the first failures do not close input', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS)

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
    expect((await throttle.getState()).failedAttempts).toBe(FREE_UNLOCK_ATTEMPTS)
  })

  it('the next failure closes input', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    await expect(throttle.assertAllowed()).rejects.toThrow(TooManyAttemptsError)
  })

  it('the error says how long to wait', async () => {
    /* A form that silently stops accepting input leaves the owner
       wondering why the correct password does not work. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    await expect(throttle.assertAllowed()).rejects.toMatchObject({
      retryAfterMs: expect.any(Number) as number,
    })
  })

  it('input opens when the wait expires', async () => {
    const { retryAfterMs } = await (async () => {
      await fail(FREE_UNLOCK_ATTEMPTS)

      return await throttle.recordFailure()
    })()

    clock.advance(retryAfterMs + 1)

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('the counter is not cleared by the wait expiring', async () => {
    /* Otherwise a guesser would get a fresh free slack after every
       wait. */
    const { retryAfterMs } = await (async () => {
      await fail(FREE_UNLOCK_ATTEMPTS)

      return await throttle.recordFailure()
    })()

    clock.advance(retryAfterMs + 1)
    await throttle.recordFailure()

    expect((await throttle.getState()).retryAfterMs).toBe(delayFor(FREE_UNLOCK_ATTEMPTS + 2))
  })

  it('a successful entry clears the counter', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS + 2)
    await throttle.recordSuccess()

    await expect(throttle.getState()).resolves.toEqual({ failedAttempts: 0, retryAfterMs: 0 })
    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })
})

describe('UnlockThrottle: state persistence', () => {
  it('the counter survives recreation', async () => {
    /* A throttle reset by refreshing the page throttles nothing:
       the guesser hits F5 after every failure. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    const restored = new UnlockThrottle({ storage, clock, logger: new NullLogger() })

    await expect(restored.assertAllowed()).rejects.toThrow(TooManyAttemptsError)
  })

  it('state lives in unencrypted settings', async () => {
    /* Otherwise the throttle would not work before unlock — exactly
       when it is needed. */
    await fail(1)

    await expect(
      storage.get(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle),
    ).resolves.not.toBeNull()
  })

  it('a corrupted record does not lock the wallet', async () => {
    /* Damaged settings must not become a permanent lockout of the
       owner from their own wallet. */
    await storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, 'garbage')

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('a record without an attempt count is treated as missing', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, {
      blockedUntil: 9_999_999_999_999,
    })

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('turning the clock back does not cancel the wait beyond reason', async () => {
    /* Full protection against a client-side clock change is
       impossible. What is checked is that the implementation at least
       does not produce a negative wait and does not open input early
       when time moves forward. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    clock.advance(1_000)

    expect((await throttle.getState()).retryAfterMs).toBeGreaterThan(0)
  })
})
