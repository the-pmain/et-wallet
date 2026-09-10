import type { StorageKey, StorageNamespace } from '@/core/storage'

import type { EncryptionKey } from './EncryptionKey'
import type { IEncryptedPayload, IKdfParams, ISecretBuffer } from './types'

/**
 * Symmetric encryption of user data.
 *
 * Responsibility:
 * - the service encrypts and decrypts arbitrary bytes;
 * - the service does NOT know what it encrypts and does NOT store the result.
 *
 * That split lets encryption be tested independently of storage and
 * prevents encryption from "deciding" what counts as a secret.
 *
 * TWO MODES, and the difference matters.
 *
 * 1. **Password** (`encrypt` / `decrypt`). The container is
 *    self-contained: it holds salt and KDF parameters, and decrypts
 *    with the password alone. Each call costs a full key derivation —
 *    hundreds of milliseconds. Used for the key vault, read once per
 *    session.
 *
 * 2. **Session** (`deriveKey` + `encryptWithKey` / `decryptWithKey`).
 *    The key is derived once at unlock and kept in memory. A call
 *    costs one AES operation. Used for individual records.
 *
 * Without the second mode every record read would cost 600 000 PBKDF2
 * iterations and the app would be unusable.
 *
 * Requirements for any implementation:
 * - Web Crypto (`crypto.subtle`) only; no homemade primitives;
 * - entropy from `crypto.getRandomValues` only, not injected: a
 *   swappable generator means predictable keys;
 * - derived keys are created with `extractable: false`;
 * - authentication-tag comparison is done by Web Crypto — no homemade
 *   byte compares, because of timing attacks.
 */
export interface IEncryptionService {
  /**
   * Encrypts data with a key derived from the password.
   *
   * Salt and IV are generated fresh inside the method on every call.
   */
  encrypt(plaintext: Uint8Array, password: string): Promise<IEncryptedPayload>

  /**
   * Decrypts a container.
   *
   * @returns A buffer the caller must wipe after use.
   * @throws DecryptionFailedError on a wrong password or integrity
   *         failure. The reason is not detailed: AES-GCM does not
   *         distinguish those cases, and guessing would give a
   *         password-guesser extra signal.
   * @throws UnsupportedVaultVersionError if the format version is newer
   *         than this build supports.
   */
  decrypt(payload: IEncryptedPayload, password: string): Promise<ISecretBuffer>

  /**
   * Checks the password without returning decrypted data.
   *
   * Needed to confirm irreversible operations (key export, password
   * change, wallet reset) where the plaintext is not required.
   */
  verifyPassword(payload: IEncryptedPayload, password: string): Promise<boolean>

  /**
   * Derives a session key from the password.
   *
   * Expensive: run once at unlock. The caller must destroy the returned
   * key on lock.
   */
  deriveKey(password: string, params: IKdfParams): Promise<EncryptionKey>

  /**
   * Encrypts data with a ready session key.
   *
   * A fresh IV is generated on every call. Reusing a key+IV pair in
   * AES-GCM destroys the mode, so an IV cannot be passed in even on
   * purpose.
   */
  encryptWithKey(
    plaintext: Uint8Array,
    key: EncryptionKey,
    params: IKdfParams,
  ): Promise<IEncryptedPayload>

  decryptWithKey(payload: IEncryptedPayload, key: EncryptionKey): Promise<ISecretBuffer>

  /** KDF parameters for new containers. Salt is generated inside. */
  createKdfParams(): IKdfParams

  /**
   * Whether the container should be re-encrypted under current parameters.
   *
   * Iteration counts grow over time with compute. A vault created years
   * ago is weaker than a new one. This is detected at unlock — the only
   * moment the password is available and a rewrite is possible.
   */
  needsUpgrade(payload: IEncryptedPayload): boolean
}

/**
 * Storage that encrypts records transparently to the caller.
 *
 * WHY A SEPARATE LAYER. `IStorageService` deliberately does not encrypt:
 * otherwise it would start deciding what counts as a secret and the
 * boundary would blur. `ISecureStorage` wraps it, adding encryption and
 * lock state.
 *
 * LAYOUT. Initialise writes a header with a salt and a verifier block.
 * Unlock derives a session key from the password, decrypts the verifier,
 * and keeps the key in memory. Each record is encrypted with that key
 * and a fresh IV.
 *
 * GUARANTEE. A value that passed through `set` reaches the backing
 * store only as ciphertext. Private keys and the seed phrase are never
 * written in the clear.
 *
 * WHAT THE LAYER DOES NOT HIDE. Namespace and key names stay visible,
 * as does value size. An observer with storage access can see how many
 * accounts the user has and when they were added, but not addresses or
 * keys.
 */
export interface ISecureStorage {
  readonly isUnlocked: boolean

  isInitialized(): Promise<boolean>

  /**
   * Creates the header: generates a salt and a verifier block.
   *
   * After the call the store stays unlocked.
   *
   * @throws WalletAlreadyInitializedError if the header already exists.
   */
  initialize(password: string): Promise<void>

  /**
   * Unlocks the store.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  unlock(password: string): Promise<void>

  /**
   * Checks the password without changing lock state.
   *
   * Needed to confirm irreversible operations — private-key export,
   * deleting an imported account, resetting the wallet.
   *
   * A separate check while already unlocked is not redundant: unlocked
   * only means the password was entered at some point, not that the
   * owner is at the device now.
   */
  verifyPassword(password: string): Promise<boolean>

  /**
   * Locks the store and releases the session key.
   *
   * Synchronous on purpose: lock must finish before control returns to
   * the event loop, otherwise there is a window where the key is still
   * available while the app thinks it is locked.
   */
  lock(): void

  /**
   * Reads and decrypts a value.
   *
   * @throws WalletLockedError if the store is locked.
   * @throws DecryptionFailedError if the record's integrity is broken.
   */
  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>

  /**
   * Encrypts and writes a value.
   *
   * @throws WalletLockedError if the store is locked.
   */
  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>

  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>

  has(namespace: StorageNamespace, key: StorageKey): Promise<boolean>

  keys(namespace: StorageNamespace): Promise<readonly StorageKey[]>

  /**
   * Changes the password, re-encrypting every record.
   *
   * Atomic: a failure mid-rewrite must not leave some records under the
   * old key and some under the new — that vault would open with neither
   * password.
   *
   * @throws InvalidPasswordError
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>

  /**
   * Deletes the header and every encrypted record.
   *
   * IRREVERSIBLE. Without a saved seed phrase the funds are lost.
   */
  destroy(): Promise<void>
}
