import { RandomnessUnavailableError } from '@/core/errors'

/**
 * Web Crypto limit on a single `getRandomValues` call.
 * Exceeding it throws `QuotaExceededError`.
 */
const MAX_BYTES_PER_CALL = 65536

/**
 * Cryptographically secure randomness.
 *
 * The ONLY allowed entropy source in the application.
 *
 * The function is deliberately NOT injected and does not take an
 * alternative generator. Being able to swap the RNG in a wallet is
 * being able to make every key predictable. Testability is not worth
 * that price: a generator swapped in a test build will eventually
 * ship to production.
 *
 * `Math.random` is categorically unfit: it is not CSPRNG, its state
 * can be recovered from a few outputs, and keys derived from it are
 * computed by an attacker directly.
 *
 * @throws RandomnessUnavailableError if Web Crypto is unavailable or
 *         the generator returned a clearly broken result.
 */
export function getRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES_PER_CALL) {
    throw new RandomnessUnavailableError(
      `requested size is not allowed: ${String(length)} bytes (allowed 1..${String(MAX_BYTES_PER_CALL)})`,
    )
  }

  const source = globalThis.crypto

  /* Missing Web Crypto is not a reason to fall back to a weak generator.
     The app must stop: a wallet without CSPRNG cannot safely create any
     key. */
  if (typeof source?.getRandomValues !== 'function') {
    throw new RandomnessUnavailableError('the Web Crypto API is unavailable in this environment')
  }

  const bytes = new Uint8Array(length)
  source.getRandomValues(bytes)

  assertNotAllZeros(bytes)

  return bytes
}

/**
 * Shortest length at which an all-zero check is meaningful.
 *
 * One byte is zero with probability 1/256, two bytes 1/65536: at those
 * lengths a healthy generator would be rejected regularly. From 16 bytes
 * the probability drops to 2^-128, and a false positive is impractical.
 */
const MIN_LENGTH_FOR_ZERO_CHECK = 16

/**
 * Rejects a clearly broken generator result.
 *
 * A broken polyfill, a test stub, or an uninitialised generator returns
 * zeroes systematically. This check cuts that failure — catastrophic,
 * because predictable entropy means predictable keys.
 *
 * WHY THERE IS A LENGTH FLOOR. A check is useful only as often as it
 * is right. On short requests zero is a normal CSPRNG value, and
 * rejecting it would be a false alarm: the user would see a broken
 * entropy-source warning where nothing is wrong. A false alarm in a
 * security system is worse than no check: it trains people to ignore
 * warnings.
 *
 * The limit is honest: short requests are unprotected. Keys and salts
 * are requested at 16 bytes or more; short values are used only for
 * shuffling and picking positions, where predictability gives an
 * attacker nothing.
 *
 * This is NOT a randomness-quality test: entropy cannot be judged from
 * one sample, and any "randomness tests" here would be self-deception.
 */
function assertNotAllZeros(bytes: Uint8Array): void {
  if (bytes.length < MIN_LENGTH_FOR_ZERO_CHECK) {
    return
  }

  if (bytes.every((byte) => byte === 0)) {
    throw new RandomnessUnavailableError(
      'the random generator returned an all-zero buffer — the entropy source is broken',
    )
  }
}

/**
 * Zeroes a buffer.
 *
 * LIMIT OF THE GUARANTEE. Wiping shortens the window the secret is in
 * memory, but does not remove the risk: V8 uses a moving GC and may
 * copy the buffer, leaving the old copy on a freed page until reuse.
 *
 * Promising more would be a lie. Wiping is mandatory, but it is not
 * process-dump protection.
 */
export function wipeBytes(bytes: Uint8Array): void {
  bytes.fill(0)
}
