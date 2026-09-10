import type { Timestamp, Unsubscribe } from '@/core/types'

/**
 * Source of time and deferred execution.
 *
 * Injected, not used directly through `Date.now` and `setTimeout`.
 * The reason is wallet auto-lock: its behaviour must be covered by
 * tests, and a test that really waits fifteen minutes is useless.
 * A swappable clock lets the timeout fire instantly and
 * deterministically.
 *
 * A second purpose is independence from system time when comparing
 * timestamps: the user changing the clock must not break core logic.
 */
export interface IClock {
  now(): Timestamp

  /**
   * Schedules a one-shot call.
   *
   * @returns Cancel function. Returning a function instead of a
   *          numeric id frees the caller from knowing the platform
   *          timer type (it differs in Node and in the browser).
   */
  setTimeout(handler: () => void, delayMs: number): Unsubscribe

  setInterval(handler: () => void, intervalMs: number): Unsubscribe
}
