import type { Timestamp, Unsubscribe } from '@/core/types'

import type { IClock } from './Clock'

/**
 * Clock over system time and platform timers.
 *
 * The only production `IClock`. Application code talks to time only
 * through the injected instance — direct `Date.now` calls make
 * auto-lock untestable.
 *
 * CANCEL INSTEAD OF AN ID. The methods return a cancel function, not
 * a number: the timer-id type differs in the browser and in Node,
 * and the caller must not know it. It also rules out "cancelled
 * someone else's timer because the numbers matched".
 */
export class SystemClock implements IClock {
  now(): Timestamp {
    return Date.now() as Timestamp
  }

  setTimeout(handler: () => void, delayMs: number): Unsubscribe {
    const id = globalThis.setTimeout(handler, delayMs)

    return () => {
      globalThis.clearTimeout(id)
    }
  }

  setInterval(handler: () => void, intervalMs: number): Unsubscribe {
    const id = globalThis.setInterval(handler, intervalMs)

    return () => {
      globalThis.clearInterval(id)
    }
  }
}
