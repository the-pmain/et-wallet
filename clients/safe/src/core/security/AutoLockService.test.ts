import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClock } from '@/test/doubles'

import { AutoLockService } from './AutoLockService'

const TIMEOUT_MS = 60_000
const WARNING_MS = 10_000

let clock: FakeClock
let service: AutoLockService

beforeEach(() => {
  clock = new FakeClock(1_700_000_000_000)
  service = new AutoLockService({ clock }, { timeoutMs: TIMEOUT_MS, warningMs: WARNING_MS })
})

describe('AutoLockService: countdown', () => {
  it('remaining time is unknown before start', () => {
    /* "Not started" and "zero left" are different states, and the
       latter means lock now. */
    expect(service.remainingMs).toBeNull()
    expect(service.isRunning).toBe(false)
  })

  it('after start remaining time equals the full timeout', () => {
    service.start()

    expect(service.remainingMs).toBe(TIMEOUT_MS)
  })

  it('remaining time decreases with time', () => {
    service.start()
    clock.advance(20_000)

    expect(service.remainingMs).toBe(TIMEOUT_MS - 20_000)
  })

  it('stop clears the countdown', () => {
    service.start()
    service.stop()

    expect(service.remainingMs).toBeNull()
    expect(service.isRunning).toBe(false)
  })

  it('a second start does not create a second timer', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).toHaveBeenCalledTimes(1)
  })
})

describe('AutoLockService: timeout expiry', () => {
  it('reports expiry when the timeout is reached', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('does not report before the timeout', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS - 5000)

    expect(expired).not.toHaveBeenCalled()
  })

  it('stops the countdown before calling the handler', () => {
    /* The handler locks the wallet; a timer that outlived the lock
       would call destroyed services. */
    let runningInsideHandler: boolean | null = null

    service.on('autolock:expired', () => {
      runningInsideHandler = service.isRunning
    })
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(runningInsideHandler).toBe(false)
  })

  it('activity postpones the lock', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS - 5000)
    service.notifyActivity()
    clock.advance(TIMEOUT_MS - 5000)

    expect(expired).not.toHaveBeenCalled()
  })

  it('activity after stop starts nothing', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()
    service.stop()
    service.notifyActivity()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).not.toHaveBeenCalled()
  })
})

describe('AutoLockService: warning', () => {
  it('warns before lock', () => {
    /* Locking mid-form loses what was typed. A warning lets the
       session be extended in one motion. */
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)

    expect(warned).toHaveBeenCalledTimes(1)
  })

  it('warns once, not on every tick', () => {
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - 2000)

    expect(warned).toHaveBeenCalledTimes(1)
  })

  it('reports the remaining time', () => {
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)

    expect(warned.mock.calls[0]?.[0]).toMatchObject({ remainingMs: expect.any(Number) })
  })

  it('activity clears the warning', () => {
    /* Otherwise it would hang until a lock that will no longer happen. */
    const resumed = vi.fn()

    service.on('autolock:resumed', resumed)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)
    service.notifyActivity()

    expect(resumed).toHaveBeenCalledTimes(1)
  })

  it('without a warning, activity does not report a resume', () => {
    const resumed = vi.fn()

    service.on('autolock:resumed', resumed)
    service.start()
    service.notifyActivity()

    expect(resumed).not.toHaveBeenCalled()
  })
})

describe('AutoLockService: changing the timeout', () => {
  it('a new timeout is applied from the start of the countdown', () => {
    /* Applying a new timeout to time already elapsed would lock the
       wallet immediately when a shorter value is chosen. */
    service.start()
    clock.advance(50_000)

    service.setTimeout(30_000)

    expect(service.remainingMs).toBe(30_000)
  })

  it('changing the timeout on a stopped service does not start the countdown', () => {
    service.setTimeout(30_000)

    expect(service.isRunning).toBe(false)
  })

  it('the warning is not longer than half of a short timeout', () => {
    /* Otherwise it would show from the first second and stop meaning
       "about to lock". */
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.setTimeout(20_000)
    service.start()

    clock.advance(5000)

    expect(warned).not.toHaveBeenCalled()
  })
})
