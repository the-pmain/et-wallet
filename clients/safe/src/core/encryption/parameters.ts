import { KDF_ALGORITHM, type IKdfParams } from './types'

/**
 * Encrypted-container format version.
 *
 * Checked BEFORE any decrypt attempt. A container newer than this build
 * fails closed, not read "as best we can": a wrong interpretation
 * followed by a rewrite means irreversible key loss.
 */
export const PAYLOAD_VERSION = 1

/**
 * PBKDF2 iteration count.
 *
 * 600 000 for HMAC-SHA256 is the current OWASP recommendation. MetaMask
 * has used the same figure since 2023.
 *
 * The value is chosen by attack cost, not taste. Doubling iterations
 * doubles both unlock time and attack cost. On the order of 10^5 the
 * delay is hundreds of milliseconds on a modern device — unnoticed by
 * the user, noticed by a guesser.
 *
 * The number GROWS over time with compute. Old vaults stay readable:
 * parameters are stored next to the ciphertext, and `needsUpgrade`
 * spots stale ones at unlock.
 */
export const PBKDF2_ITERATIONS = 600_000

/**
 * PBKDF2 hash.
 *
 * SHA-256, not SHA-512, on purpose: the OWASP iteration count is for
 * SHA-256, and on 64-bit platforms SHA-512 is faster, which helps a
 * GPU attacker at the same iteration count.
 */
export const PBKDF2_HASH = 'SHA-256'

/**
 * Salt length in bytes.
 *
 * A fresh salt is generated per container. Its job is to make
 * precomputed tables useless: without a salt, one table would crack
 * every weak-password wallet at once.
 */
export const SALT_LENGTH = 32

/**
 * AES-GCM IV length in bytes.
 *
 * 96 bits is the size for which the mode is defined directly. A longer
 * IV is hashed first (extra work, no gain); a shorter one weakens the
 * mode.
 *
 * RANDOM-IV LIMIT. With a random 96-bit IV, collision probability
 * becomes noticeable after about 2^32 operations with one key. For a
 * wallet vault that is unreachable: the key lives one session, and
 * writes per session are in the hundreds.
 */
export const IV_LENGTH = 12

/** AES key length in bytes. 32 bytes is AES-256. */
export const KEY_LENGTH = 32

/** GCM authentication-tag length in bits. 128 is the maximum and the default. */
export const AUTH_TAG_BITS = 128

export const AES_GCM = 'AES-GCM'

export const PBKDF2 = 'PBKDF2'

/**
 * KDF parameters applied to new containers.
 *
 * Salt is not included: it is generated per encryption. The function
 * takes salt as an argument so one value cannot be reused by accident.
 */
export function createDefaultKdfParams(salt: Uint8Array): IKdfParams {
  return {
    algorithm: KDF_ALGORITHM.Pbkdf2,
    iterations: PBKDF2_ITERATIONS,
    salt,
    keyLength: KEY_LENGTH,
  }
}
