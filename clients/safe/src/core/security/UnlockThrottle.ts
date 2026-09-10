import { TooManyAttemptsError } from '@/core/errors'
import type { IClock, ILogger } from '@/core/platform'
import { SETTINGS_KEY, STORAGE_NAMESPACE, type IStorageService } from '@/core/storage'

const SERVICE_NAME = 'UnlockThrottle'

/**
 * How many attempts pass with no delay.
 *
 * Three is slack for a typo and a wrong keyboard layout. Fewer would
 * punish a miss; more would give a guesser free tries.
 */
const FREE_ATTEMPTS = 3

/**
 * Delay after each further failure, in milliseconds.
 *
 * A table, not a formula. A formula is shorter, but its values have to
 * be worked out in one's head while reading, and they decide whether
 * the wallet stays usable for the owner. Growth is close to 4×: it
 * quickly makes dictionary guessing worthless without locking out
 * someone who just forgot the layout.
 */
const DELAYS_MS: readonly number[] = [
  5_000, // 4th attempt
  15_000, // 5th
  60_000, // 6th
  5 * 60_000, // 7th
  15 * 60_000, // 8th and later
]

export interface IUnlockThrottleState {
  readonly failedAttempts: number

  /** Milliseconds left to wait. Zero means input is open. */
  readonly retryAfterMs: number
}

interface IThrottleRecord {
  readonly failedAttempts: number
  readonly blockedUntil: number | null
}

const EMPTY_STATE: IUnlockThrottleState = { failedAttempts: 0, retryAfterMs: 0 }

export interface IUnlockThrottleDependencies {
  /**
   * UNENCRYPTED storage.
   *
   * It cannot be otherwise: the throttle runs before unlock, when the
   * decryption key has not been derived yet.
   */
  readonly storage: IStorageService

  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Password-attempt throttle.
 *
 * WHAT IT PROTECTS AGAINST. Password guessing through the app UI: a
 * person at a left-behind device, a malicious extension, a page
 * script. Each further failure costs more than the last, and a
 * dictionary attack becomes pointless.
 *
 * WHAT IT DOES NOT PROTECT AGAINST, AND THAT MUST BE UNDERSTOOD.
 * Whoever has disk access will zero the counter — it lives in
 * unencrypted settings because it must be readable before unlock.
 * That adversary does not need the throttle: having copied the vault,
 * they guess the password on their own, without us. The only defence
 * against that is key-derivation cost: 600 000 PBKDF2 iterations per
 * try.
 *
 * THE COUNTER SURVIVES RELOAD. A throttle reset by refreshing the page
 * throttles nothing: the guesser hits F5 after every failure. Persist
 * became possible only once durable storage existed.
 *
 * TIME COMES FROM THE CLOCK, NOT `Date.now()`. Turning the system clock
 * back is the obvious way around a wait, and it works against any
 * client-side implementation. A single time source at least makes the
 * behaviour testable.
 */
export class UnlockThrottle {
  readonly #storage: IStorageService
  readonly #clock: IClock
  readonly #logger: ILogger

  constructor(dependencies: IUnlockThrottleDependencies) {
    this.#storage = dependencies.storage
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  /**
   * Checks whether input is open.
   *
   * @throws TooManyAttemptsError with the remaining wait.
   */
  async assertAllowed(): Promise<void> {
    const { retryAfterMs } = await this.getState()

    if (retryAfterMs > 0) {
      throw new TooManyAttemptsError(retryAfterMs)
    }
  }

  /** Current state. The UI needs it for a countdown. */
  async getState(): Promise<IUnlockThrottleState> {
    const record = await this.#read()

    if (record === null) {
      return EMPTY_STATE
    }

    const remaining = record.blockedUntil === null ? 0 : record.blockedUntil - this.#clock.now()

    return {
      failedAttempts: record.failedAttempts,
      retryAfterMs: Math.max(0, remaining),
    }
  }

  /**
   * Records a failed attempt and assigns a delay.
   *
   * @returns State after write — so the caller can show the wait
   *          without reading storage again.
   */
  async recordFailure(): Promise<IUnlockThrottleState> {
    const previous = await this.#read()
    const failedAttempts = (previous?.failedAttempts ?? 0) + 1
    const delayMs = delayFor(failedAttempts)

    const record: IThrottleRecord = {
      failedAttempts,
      blockedUntil: delayMs === 0 ? null : this.#clock.now() + delayMs,
    }

    await this.#write(record)

    if (delayMs > 0) {
      /* The password never goes in the log — only the fact and the
         wait: the record exists so the owner can notice foreign
         unlock attempts. */
      this.#logger.warn('Password entry is temporarily closed', {
        failedAttempts,
        delaySeconds: Math.round(delayMs / 1000),
      })
    }

    return { failedAttempts, retryAfterMs: delayMs }
  }

  /**
   * Records a successful entry.
   *
   * The counter is cleared entirely: a correct password means the
   * owner is at the device, and accumulated suspicion no longer
   * applies.
   */
  async recordSuccess(): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle)
  }

  /** Reads the record, discarding a corrupted one. */
  async #read(): Promise<IThrottleRecord | null> {
    const stored = await this.#storage.get<unknown>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UnlockThrottle,
    )

    if (typeof stored !== 'object' || stored === null) {
      return null
    }

    const record = stored as Record<string, unknown>
    const failedAttempts = record['failedAttempts']
    const blockedUntil = record['blockedUntil']

    if (typeof failedAttempts !== 'number' || !Number.isSafeInteger(failedAttempts)) {
      /* A corrupted record is treated as no limit, not as a permanent
         lock: otherwise damaged settings would lock the owner out of
         their own wallet forever. */
      this.#logger.warn('The throttle state was corrupted and has been reset')

      return null
    }

    return {
      failedAttempts,
      blockedUntil: typeof blockedUntil === 'number' ? blockedUntil : null,
    }
  }

  async #write(record: IThrottleRecord): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, record)
  }
}

/**
 * Delay after the given number of consecutive failures.
 *
 * Exported for tests and the UI: the unlock screen warns as the
 * threshold approaches, and taking the values from a second place
 * would be a way to desynchronise them.
 */
export function delayFor(failedAttempts: number): number {
  if (failedAttempts <= FREE_ATTEMPTS) {
    return 0
  }

  const index = Math.min(failedAttempts - FREE_ATTEMPTS - 1, DELAYS_MS.length - 1)

  return DELAYS_MS[index] ?? 0
}

/** How many attempts pass with no delay. The UI needs this for a hint. */
export const FREE_UNLOCK_ATTEMPTS = FREE_ATTEMPTS
