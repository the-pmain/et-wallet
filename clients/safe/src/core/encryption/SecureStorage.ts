import { utf8ToBytes } from '@noble/hashes/utils.js'

import {
  InvalidPasswordError,
  VaultCorruptedError,
  WalletAlreadyInitializedError,
  WalletLockedError,
  WalletNotInitializedError,
} from '@/core/errors'
import {
  STORAGE_NAMESPACE,
  toStorageKey,
  type IStorageService,
  type StorageKey,
  type StorageNamespace,
} from '@/core/storage'

import type { IEncryptionService, ISecureStorage } from './contracts'
import type { EncryptionKey } from './EncryptionKey'
import { PAYLOAD_VERSION } from './parameters'
import { decodePayload, encodePayload, type IEncryptedPayloadRecord } from './payload-codec'
import type { IEncryptedPayload, IKdfParams } from './types'

/** Header key in the settings namespace. */
const HEADER_KEY: StorageKey = toStorageKey('secure-storage.header')

/**
 * Verifier string.
 *
 * Encrypted at initialise and decrypted at unlock. Distinguishes a
 * wrong password from corrupted user data without touching that data.
 *
 * Known plaintext is not a risk: AES-GCM resists known-plaintext
 * attacks, and password-guessing cost is set by the KDF, not by
 * secrecy of the verifier.
 */
const VERIFIER_PLAINTEXT = 'wallet.secure-storage.v1'

/** Marker for a record encrypted by this layer. */
const ENVELOPE_MARKER = 'enc' as const

interface IEncryptedEnvelope {
  readonly __type: typeof ENVELOPE_MARKER
  readonly payload: IEncryptedPayloadRecord
}

/** Vault header. Holds no secrets. */
interface ISecureStorageHeader {
  readonly version: number
  readonly kdf: IEncryptedPayloadRecord['kdf']
  readonly verifier: IEncryptedPayloadRecord
}

function isEncryptedEnvelope(value: unknown): value is IEncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<IEncryptedEnvelope>).__type === ENVELOPE_MARKER
  )
}

/**
 * Store that encrypts records transparently.
 *
 * LAYOUT. One salt for the whole vault, in the header; each record has
 * its own IV. The session key is derived once at unlock and lives until
 * lock.
 *
 * Why not derive per operation: PBKDF2 at 600 000 iterations takes
 * hundreds of milliseconds. Reading the account list on screen open
 * would take seconds and the app would be unusable. Strength is not
 * hurt: password guessing still pays the cost of one derivation.
 *
 * GUARANTEE. A value that passed through `set` reaches the backing
 * store only inside a ciphertext envelope. A plaintext copy is never
 * persisted.
 *
 * WHAT THE LAYER DOES NOT HIDE: namespace and key names, record count,
 * and approximate value size. An observer with storage access learns
 * how many accounts the user has, but not addresses or keys.
 *
 * TYPE LIMIT. Values are JSON-serialised, so `bigint` is not supported
 * directly: `JSON.stringify` throws on it. Monetary amounts are turned
 * into strings at the repository — same as `chainId` in the network
 * module.
 */
export class SecureStorage implements ISecureStorage {
  readonly #storage: IStorageService
  readonly #encryption: IEncryptionService

  #sessionKey: EncryptionKey | null = null
  #kdfParams: IKdfParams | null = null

  constructor(storage: IStorageService, encryption: IEncryptionService) {
    this.#storage = storage
    this.#encryption = encryption
  }

  get isUnlocked(): boolean {
    return this.#sessionKey !== null
  }

  async isInitialized(): Promise<boolean> {
    return (await this.#readHeader()) !== null
  }

  async initialize(password: string): Promise<void> {
    if (await this.isInitialized()) {
      throw new WalletAlreadyInitializedError()
    }

    const kdfParams = this.#encryption.createKdfParams()
    const key = await this.#encryption.deriveKey(password, kdfParams)

    const verifier = await this.#encryption.encryptWithKey(
      utf8ToBytes(VERIFIER_PLAINTEXT),
      key,
      kdfParams,
    )

    const header: ISecureStorageHeader = {
      version: PAYLOAD_VERSION,
      kdf: encodePayload(verifier).kdf,
      verifier: encodePayload(verifier),
    }

    await this.#storage.set(STORAGE_NAMESPACE.Settings, HEADER_KEY, header)

    this.#sessionKey = key
    this.#kdfParams = kdfParams
  }

  async unlock(password: string): Promise<void> {
    const header = await this.#readHeader()

    if (header === null) {
      throw new WalletNotInitializedError()
    }

    const verifier = decodePayload(header.verifier)
    const key = await this.#encryption.deriveKey(password, verifier.kdf)

    let decrypted

    try {
      decrypted = await this.#encryption.decryptWithKey(verifier, key)
    } catch {
      key.destroy()

      /* Verifier decrypt failed. The reason is not detailed:
         distinguishing "wrong password" from "header corrupted" is
         information for a password guesser. */
      throw new InvalidPasswordError()
    }

    decrypted.wipe()

    this.#sessionKey = key
    this.#kdfParams = verifier.kdf
  }

  async verifyPassword(password: string): Promise<boolean> {
    const header = await this.#readHeader()

    if (header === null) {
      return false
    }

    const verifier = decodePayload(header.verifier)
    const key = await this.#encryption.deriveKey(password, verifier.kdf)

    try {
      ;(await this.#encryption.decryptWithKey(verifier, key)).wipe()

      return true
    } catch {
      return false
    } finally {
      /* The probe key is destroyed either way: it must not outlive the
         check and stay available to the caller. */
      key.destroy()
    }
  }

  lock(): void {
    this.#sessionKey?.destroy()
    this.#sessionKey = null
    this.#kdfParams = null
  }

  async get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
    const session = this.#requireUnlocked()
    const stored = await this.#storage.get<unknown>(namespace, key)

    if (stored === null) {
      return null
    }

    if (!isEncryptedEnvelope(stored)) {
      /* A record exists but was not encrypted by this layer. Returning
         it silently would mean a secret was once written around
         encryption, and that state must be noticed. */
      throw new VaultCorruptedError(`the record "${key}" is not encrypted`)
    }

    const plaintext = await this.#encryption.decryptWithKey(decodePayload(stored.payload), session)

    try {
      return JSON.parse(new TextDecoder().decode(plaintext.bytes)) as TValue
    } finally {
      plaintext.wipe()
    }
  }

  async set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void> {
    const session = this.#requireUnlocked()

    await this.#storage.set(namespace, key, await this.#seal(value, session))
  }

  async remove(namespace: StorageNamespace, key: StorageKey): Promise<void> {
    await this.#storage.remove(namespace, key)
  }

  async has(namespace: StorageNamespace, key: StorageKey): Promise<boolean> {
    return await this.#storage.has(namespace, key)
  }

  async keys(namespace: StorageNamespace): Promise<readonly StorageKey[]> {
    return await this.#storage.keys(namespace)
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const header = await this.#readHeader()

    if (header === null) {
      throw new WalletNotInitializedError()
    }

    const verifier = decodePayload(header.verifier)
    const currentKey = await this.#encryption.deriveKey(currentPassword, verifier.kdf)

    try {
      await this.#assertPasswordMatches(verifier, currentKey)

      const nextParams = this.#encryption.createKdfParams()
      const nextKey = await this.#encryption.deriveKey(newPassword, nextParams)

      try {
        await this.#reencryptAll(currentKey, nextKey, nextParams)

        /* The session key is replaced only after a successful rewrite:
           on failure the vault stays under the old password and the
           session stays consistent with it. */
        this.#sessionKey?.destroy()
        this.#sessionKey = await this.#encryption.deriveKey(newPassword, nextParams)
        this.#kdfParams = nextParams
      } finally {
        nextKey.destroy()
      }
    } finally {
      currentKey.destroy()
    }
  }

  async destroy(): Promise<void> {
    this.lock()

    for (const namespace of Object.values(STORAGE_NAMESPACE)) {
      await this.#storage.clear(namespace)
    }
  }

  /**
   * Re-encrypts every record and updates the header.
   *
   * Done in one transaction. A partial rewrite would leave some records
   * under the old key and some under the new — that vault would open
   * with neither password.
   */
  async #reencryptAll(
    currentKey: EncryptionKey,
    nextKey: EncryptionKey,
    nextParams: IKdfParams,
  ): Promise<void> {
    const namespaces = Object.values(STORAGE_NAMESPACE)

    /* Re-encryption runs before the transaction opens: crypto is async,
       and an IndexedDB transaction closes on the first event-loop turn
       that does not touch it. */
    const rewritten: { namespace: StorageNamespace; key: StorageKey; value: unknown }[] = []

    for (const namespace of namespaces) {
      for (const key of await this.#storage.keys(namespace)) {
        const stored = await this.#storage.get<unknown>(namespace, key)

        if (!isEncryptedEnvelope(stored)) {
          continue
        }

        const plaintext = await this.#encryption.decryptWithKey(
          decodePayload(stored.payload),
          currentKey,
        )

        try {
          const resealed = await this.#encryption.encryptWithKey(
            plaintext.bytes,
            nextKey,
            nextParams,
          )

          rewritten.push({
            namespace,
            key,
            value: { __type: ENVELOPE_MARKER, payload: encodePayload(resealed) },
          })
        } finally {
          plaintext.wipe()
        }
      }
    }

    const verifier = await this.#encryption.encryptWithKey(
      utf8ToBytes(VERIFIER_PLAINTEXT),
      nextKey,
      nextParams,
    )

    const header: ISecureStorageHeader = {
      version: PAYLOAD_VERSION,
      kdf: encodePayload(verifier).kdf,
      verifier: encodePayload(verifier),
    }

    await this.#storage.transaction(namespaces, async (transaction) => {
      for (const entry of rewritten) {
        await transaction.set(entry.namespace, entry.key, entry.value)
      }

      await transaction.set(STORAGE_NAMESPACE.Settings, HEADER_KEY, header)
    })
  }

  async #assertPasswordMatches(verifier: IEncryptedPayload, key: EncryptionKey): Promise<void> {
    try {
      ;(await this.#encryption.decryptWithKey(verifier, key)).wipe()
    } catch {
      throw new InvalidPasswordError()
    }
  }

  async #seal<TValue>(value: TValue, key: EncryptionKey): Promise<IEncryptedEnvelope> {
    const plaintext = utf8ToBytes(JSON.stringify(value))

    try {
      const payload = await this.#encryption.encryptWithKey(
        plaintext,
        key,
        this.#requireKdfParams(),
      )

      return { __type: ENVELOPE_MARKER, payload: encodePayload(payload) }
    } finally {
      /* The plaintext copy is wiped immediately: it may have held a
         private key or a mnemonic. */
      plaintext.fill(0)
    }
  }

  async #readHeader(): Promise<ISecureStorageHeader | null> {
    return await this.#storage.get<ISecureStorageHeader>(STORAGE_NAMESPACE.Settings, HEADER_KEY)
  }

  #requireUnlocked(): EncryptionKey {
    if (this.#sessionKey === null) {
      throw new WalletLockedError('access to the encrypted storage')
    }

    return this.#sessionKey
  }

  #requireKdfParams(): IKdfParams {
    if (this.#kdfParams === null) {
      throw new WalletLockedError('access to the encryption parameters')
    }

    return this.#kdfParams
  }
}
