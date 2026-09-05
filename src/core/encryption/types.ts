/**
 * Password-based key-derivation algorithms.
 *
 * PBKDF2 is native in WebCrypto, but resists guessing only through
 * iteration count — so it fares poorly against GPU and ASIC attacks.
 * Argon2id also costs memory, but WebCrypto does not include it and a
 * WASM implementation would be required.
 *
 * Choosing the algorithm is an encryption-implementation step. The
 * storage format supports both so a later switch does not break the vault.
 */
export const KDF_ALGORITHM = {
  Pbkdf2: 'PBKDF2',
  Argon2id: 'Argon2id',
} as const

export type KdfAlgorithm = (typeof KDF_ALGORITHM)[keyof typeof KDF_ALGORITHM]

/** Authenticated symmetric cipher (AEAD). */
export const CIPHER_ALGORITHM = {
  AesGcm: 'AES-GCM',
} as const

export type CipherAlgorithm = (typeof CIPHER_ALGORITHM)[keyof typeof CIPHER_ALGORITHM]

/**
 * Key-derivation parameters.
 *
 * Stored next to the ciphertext. Without them, data cannot be decrypted
 * after a later version changes the parameters: the key would be derived
 * differently, while old records stay encrypted under the old rules.
 */
export interface IKdfParams {
  readonly algorithm: KdfAlgorithm

  /** Iteration count (PBKDF2) or pass count (Argon2id). */
  readonly iterations: number

  /**
   * Salt. Generated fresh for every encryption.
   * Reusing a salt lets an attacker hit several vaults with one
   * precomputed table.
   */
  readonly salt: Uint8Array

  readonly keyLength: number

  /** Memory cost in kibibytes. Argon2id only. */
  readonly memoryKib?: number

  /** Parallelism. Argon2id only. */
  readonly parallelism?: number
}

/**
 * Encrypted container.
 *
 * Self-contained: holds everything needed to decrypt except the password.
 * That is required — otherwise a vault backup is useless without knowing
 * the settings of the app version that created it.
 */
export interface IEncryptedPayload {
  /**
   * Container format version.
   *
   * Checked BEFORE any decrypt attempt. A container newer than this build
   * must fail closed, not be read "as best we can": a wrong interpretation
   * followed by a rewrite means irreversible key loss.
   */
  readonly version: number

  readonly cipher: CipherAlgorithm

  readonly kdf: IKdfParams

  /**
   * Initialisation vector.
   *
   * For AES-GCM, reusing a key+IV pair destroys the mode: both the
   * plaintext and the authentication key leak. A fresh IV is generated
   * for every encryption, without exceptions.
   */
  readonly iv: Uint8Array

  /** Ciphertext including the authentication tag. */
  readonly ciphertext: Uint8Array
}

/**
 * Buffer holding secret bytes.
 *
 * Exists because `string` is unfit for secrets: JavaScript strings are
 * immutable and interned. Their contents cannot be wiped — they stay on
 * the heap until garbage collection, whose timing is uncontrolled. A tab
 * memory dump in that window reveals the secret.
 *
 * `Uint8Array` can be wiped explicitly.
 *
 * Rules:
 * - wipe the buffer immediately after use, in a `finally` block;
 * - do not keep it in UI state or pass it across layers longer than one
 *   operation requires;
 * - reading `bytes` after `wipe()` is an error, not an empty result.
 */
export interface ISecretBuffer {
  /**
   * Buffer contents.
   *
   * @throws SecretBufferWipedError if the buffer has already been wiped.
   */
  readonly bytes: Uint8Array

  readonly isWiped: boolean

  /**
   * Zeroes the contents and marks the buffer invalid.
   * A second call is safe.
   */
  wipe(): void
}
