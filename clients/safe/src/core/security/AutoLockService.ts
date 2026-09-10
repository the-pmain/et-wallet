import { EventBus, type EventListener } from '@/core/events'
import type { IClock } from '@/core/platform'
import type { Unsubscribe } from '@/core/types'

/**
 * Default: fifteen minutes of inactivity.
 *
 * A compromise between two harms. Too short forces a password mid-work,
 * and the user picks the longest available timeout or turns the
 * protection off. Too long leaves keys in memory of an unlocked wallet
 * on an abandoned device.
 */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

/**
 * How far before lock a warning is shown.
 *
 * Locking mid-send-form loses what was typed. A warning lets the
 * session be extended in one motion — and explains why the wallet
 * suddenly closed if the person looked away.
 */
const DEFAULT_WARNING_MS = 60 * 1000

const TICK_INTERVAL_MS = 5 * 1000

export interface AutoLockEventMap {
  /** Less than the warning threshold remains until lock. */
  'autolock:warning': { readonly remainingMs: number }

  /** Warning cleared: the user was active. */
  'autolock:resumed': Record<string, never>

  /** The timeout expired; the wallet should lock. */
  'autolock:expired': Record<string, never>
}

export interface IAutoLockOptions {
  readonly timeoutMs?: number

  readonly warningMs?: number
}

export interface IAutoLockDependencies {
  readonly clock: IClock
}

/**
 * Idle auto-lock.
 *
 * WHY IT EXISTS. An unlocked wallet holds the root key derived from
 * the seed phrase in memory. While the session is open, anyone who
 * gets the device can move funds without the password. Auto-lock
 * bounds that window by time, not by trust in the surroundings.
 *
 * THE CORE DOES NOT KNOW ABOUT BROWSER EVENTS. The service counts
 * time and listens to nothing: keypresses and pointer moves are
 * tracked by the app layer, which reports them via `notifyActivity`.
 * Otherwise the core would stop working in a service worker, where
 * there is no DOM.
 *
 * THE SERVICE DOES NOT LOCK THE WALLET ITSELF. It reports that the
 * timeout expired; the session owner performs the lock. The split
 * keeps the shutdown order — stop polling, drop connections, wipe
 * the key — in one place.
 *
 * THERE ARE NO EXCEPTIONS FOR "IMPORTANT SCREENS". A carve-out
 * "do not lock while the send form is open" would make the
 * protection optional: leave that form open. Instead of an
 * exception — a warning in advance.
 */
export class AutoLockService {
  readonly #clock: IClock
  readonly #events = new EventBus<AutoLockEventMap>()

  #timeoutMs: number
  #warningMs: number

  #lastActivityAt = 0
  #stopTicking: Unsubscribe | null = null
  #isWarned = false

  constructor(dependencies: IAutoLockDependencies, options: IAutoLockOptions = {}) {
    this.#clock = dependencies.clock
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#warningMs = options.warningMs ?? DEFAULT_WARNING_MS
  }

  get isRunning(): boolean {
    return this.#stopTicking !== null
  }

  get timeoutMs(): number {
    return this.#timeoutMs
  }

  /**
   * Time left until lock.
   *
   * `null` when the countdown is not running: "not started" and
   * "zero left" are different states, and the latter means lock now.
   */
  get remainingMs(): number | null {
    if (this.#stopTicking === null) {
      return null
    }

    return Math.max(0, this.#lastActivityAt + this.#timeoutMs - this.#clock.now())
  }

  /** Restarts the countdown. A second call does not create a second timer. */
  start(): void {
    this.stop()

    this.#lastActivityAt = this.#clock.now()
    this.#isWarned = false

    this.#stopTicking = this.#clock.setInterval(() => {
      this.#tick()
    }, TICK_INTERVAL_MS)
  }

  /** Stops the countdown. Called when the wallet locks. */
  stop(): void {
    this.#stopTicking?.()
    this.#stopTicking = null
    this.#isWarned = false
  }

  /**
   * Records user activity.
   *
   * Called by the app layer on input events. If a warning is already
   * showing, it is cleared — otherwise it would hang until a lock
   * that will no longer happen.
   */
  notifyActivity(): void {
    if (this.#stopTicking === null) {
      return
    }

    this.#lastActivityAt = this.#clock.now()

    if (this.#isWarned) {
      this.#isWarned = false
      this.#events.emit('autolock:resumed', {})
    }
  }

  /**
   * Changes the idle timeout.
   *
   * The countdown restarts: applying a new timeout to time already
   * elapsed would lock the wallet immediately when a shorter value
   * is chosen.
   */
  setTimeout(timeoutMs: number): void {
    this.#timeoutMs = timeoutMs

    /* The warning cannot be longer than the timeout itself: otherwise
       it would show from the first second and stop meaning
       "about to lock". */
    this.#warningMs = Math.min(DEFAULT_WARNING_MS, Math.floor(timeoutMs / 2))

    if (this.#stopTicking !== null) {
      this.start()
    }
  }

  on<TEvent extends keyof AutoLockEventMap>(
    event: TEvent,
    listener: EventListener<AutoLockEventMap[TEvent]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  /** Checks the timeout and reports events that have occurred. */
  #tick(): void {
    const remaining = this.remainingMs

    if (remaining === null) {
      return
    }

    if (remaining <= 0) {
      /* Stop before emitting: the handler locks the wallet, and a
         timer that outlived the lock would keep calling destroyed
         services. */
      this.stop()
      this.#events.emit('autolock:expired', {})

      return
    }

    if (remaining <= this.#warningMs && !this.#isWarned) {
      this.#isWarned = true
      this.#events.emit('autolock:warning', { remainingMs: remaining })
    }
  }
}
