import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { assertValidPrivateKey } from '@/core/address'
import { SecretBuffer, type ISecretBuffer, type ISecureStorage } from '@/core/encryption'
import { AccountNotFoundError, VaultCorruptedError } from '@/core/errors'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { AccountId } from '@/core/types'

/** Storage-key prefix that keeps imported keys apart from the rest. */
const KEY_PREFIX = 'imported-key.'

/**
 * Store of imported private keys.
 *
 * THE DIFFERENCE FROM HD ACCOUNTS that defines all behaviour: a key
 * that lands here exists in a single copy. It is not derived from
 * the seed phrase and will not appear on wallet restore. Losing it
 * is final.
 *
 * Hence two consequences:
 * - removal requires a password confirmation at the layer above;
 * - writing is done only through `ISecureStorage`, i.e. always
 *   encrypted.
 *
 * The key is stored as a hex string: `SecureStorage` serialises
 * values through JSON, where `Uint8Array` becomes an object with
 * numeric keys and is silently corrupted. The string exists in the
 * heap uncleared for a short time — a limit common to all secret
 * handling in JavaScript.
 */
export class ImportedKeyStore {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  /**
   * Saves the key bound to an account.
   *
   * Ownership of the passed buffer is NOT taken: the caller wipes
   * it themselves.
   */
  async save(accountId: AccountId, privateKey: ISecretBuffer): Promise<void> {
    assertValidPrivateKey(privateKey.bytes)

    await this.#storage.set(
      STORAGE_NAMESPACE.Vault,
      ImportedKeyStore.#keyOf(accountId),
      bytesToHex(privateKey.bytes),
    )
  }

  /**
   * Reads an account key.
   *
   * @returns A buffer the caller must wipe.
   * @throws AccountNotFoundError if there is no key.
   * @throws VaultCorruptedError if the record is corrupted.
   */
  async load(accountId: AccountId): Promise<ISecretBuffer> {
    const stored = await this.#storage.get<string>(
      STORAGE_NAMESPACE.Vault,
      ImportedKeyStore.#keyOf(accountId),
    )

    if (stored === null) {
      throw new AccountNotFoundError(accountId)
    }

    let bytes: Uint8Array

    try {
      bytes = hexToBytes(stored)
    } catch (error) {
      throw new VaultCorruptedError('the private key of the account is corrupted', { cause: error })
    }

    /* The range check is done on read as well: the record may have
       been written by an older app version without that check, and
       a key outside 1..n-1 does not define a curve point. */
    assertValidPrivateKey(bytes)

    return SecretBuffer.own(bytes)
  }

  async has(accountId: AccountId): Promise<boolean> {
    return await this.#storage.has(STORAGE_NAMESPACE.Vault, ImportedKeyStore.#keyOf(accountId))
  }

  /**
   * Removes the key.
   *
   * IRREVERSIBLE: it cannot be restored from the seed phrase.
   */
  async remove(accountId: AccountId): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Vault, ImportedKeyStore.#keyOf(accountId))
  }

  static #keyOf(accountId: AccountId): StorageKey {
    return toStorageKey(`${KEY_PREFIX}${accountId}`)
  }
}
