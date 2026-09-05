import type { IClock, Timestamp, Unsubscribe } from '@/core'

/**
 * Controllable clock for tests.
 *
 * Time does not move by itself: it advances only via `advance`.
 * That makes timeout tests deterministic and instant — a
 * fifteen-minute autolock check must not take fifteen minutes.
 */
export class FakeClock implements IClock {
  #now: number

  readonly #timers = new Map<number, { at: number; handler: () => void; interval: number | null }>()

  #nextTimerId = 1

  constructor(startAt = 0) {
    this.#now = startAt
  }

  now(): Timestamp {
    return this.#now as Timestamp
  }

  setTimeout(handler: () => void, delayMs: number): Unsubscribe {
    const id = this.#nextTimerId++
    this.#timers.set(id, { at: this.#now + delayMs, handler, interval: null })

    return () => {
      this.#timers.delete(id)
    }
  }

  setInterval(handler: () => void, intervalMs: number): Unsubscribe {
    const id = this.#nextTimerId++
    this.#timers.set(id, { at: this.#now + intervalMs, handler, interval: intervalMs })

    return () => {
      this.#timers.delete(id)
    }
  }

  /** Moves time forward and fires due timers. */
  advance(deltaMs: number): void {
    const target = this.#now + deltaMs

    /* Loop, not a single pass: an interval handler may fire
       several times in one step. */
    let progressed = true

    while (progressed) {
      progressed = false

      for (const [id, timer] of [...this.#timers]) {
        if (timer.at > target) {
          continue
        }

        this.#now = timer.at

        if (timer.interval === null) {
          this.#timers.delete(id)
        } else {
          this.#timers.set(id, { ...timer, at: timer.at + timer.interval })
        }

        timer.handler()
        progressed = true
      }
    }

    this.#now = target
  }

  /** Active timer count. Lets tests check there are no leaks. */
  get pendingTimers(): number {
    return this.#timers.size
  }
}
