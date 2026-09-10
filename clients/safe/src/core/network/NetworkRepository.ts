import type { ISecureStorage } from '@/core/encryption'
import { SETTINGS_KEY, STORAGE_NAMESPACE, toStorageKey, type IStorageService } from '@/core/storage'
import { toChainId, type ChainId } from '@/core/types'

import type { INetworkRepository } from './contracts'
import type { INativeCurrency, INetworkConfig } from './types'

/**
 * Stored representation of a network configuration.
 *
 * Differs from the domain model in one field: `chainId` is stored
 * as a decimal string, not a `bigint`.
 *
 * Why. The domain uses `bigint`, but requiring every storage backend
 * to support it is an extra constraint: `JSON.stringify` throws on
 * `bigint`, and `chrome.storage` serializes through JSON. Converting
 * to a string in one place makes the data portable across IndexedDB,
 * `chrome.storage`, and an in-memory implementation without codecs.
 */
interface INetworkConfigRecord {
  readonly chainId: string
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly rpcUrls: readonly string[]
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean
  readonly isBuiltIn: boolean
  readonly supportsEip1559: boolean
}

function toRecord(config: INetworkConfig): INetworkConfigRecord {
  return {
    chainId: config.chainId.toString(),
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: config.rpcUrls,
    blockExplorerUrls: config.blockExplorerUrls,
    isTestnet: config.isTestnet,
    isBuiltIn: config.isBuiltIn,
    supportsEip1559: config.supportsEip1559,
  }
}

function fromRecord(record: INetworkConfigRecord): INetworkConfig {
  return {
    chainId: toChainId(record.chainId),
    name: record.name,
    nativeCurrency: record.nativeCurrency,
    rpcUrls: record.rpcUrls,
    blockExplorerUrls: record.blockExplorerUrls,
    isTestnet: record.isTestnet,
    isBuiltIn: record.isBuiltIn,
    supportsEip1559: record.supportsEip1559,
  }
}

/**
 * Network storage.
 *
 * RECORDS ARE ENCRYPTED. A network configuration is not a secret
 * by itself: chainId and the currency symbol are public. But a
 * user-added network has the user's node address in `rpcUrls`,
 * and that address usually carries the operator account key —
 * right in the string. In plaintext on disk that is the same as
 * a written-down password to a third-party service.
 *
 * NETWORKS ARE NEEDED ONLY AFTER UNLOCK. The list is read when
 * the session opens, after the encryption key is already derived,
 * so encryption breaks nothing: until the password is entered
 * the wallet does not talk to nodes anyway.
 *
 * LEGACY RECORDS ARE MIGRATED. Wallets created before this change
 * store networks in plaintext. Migration runs on the first read
 * and deletes the plaintext records: leaving them would mean
 * encryption buys nothing.
 */
export class NetworkRepository implements INetworkRepository {
  readonly #storage: ISecureStorage

  /* Plaintext store of the old format. `null` when there is
     nothing to migrate — e.g. in checks that start from a clean slate. */
  readonly #legacy: IStorageService | null

  constructor(storage: ISecureStorage, legacy: IStorageService | null = null) {
    this.#storage = storage
    this.#legacy = legacy
  }

  async findAll(): Promise<readonly INetworkConfig[]> {
    await this.#migrateLegacy()

    const keys = await this.#storage.keys(STORAGE_NAMESPACE.NetworksEncrypted)
    const configs: INetworkConfig[] = []

    for (const key of keys) {
      const record = await this.#storage.get<INetworkConfigRecord>(
        STORAGE_NAMESPACE.NetworksEncrypted,
        key,
      )

      if (record !== null) {
        configs.push(fromRecord(record))
      }
    }

    return configs
  }

  /**
   * Moves networks from the plaintext store into the encrypted one.
   *
   * ORDER MATTERS: write to encrypted first, then delete from
   * plaintext. The reverse order would lose a user network if a
   * crash hit mid-migration; this one at worst leaves a copy that
   * the next launch will remove.
   */
  async #migrateLegacy(): Promise<void> {
    const legacy = this.#legacy

    if (legacy === null) {
      return
    }

    const keys = await legacy.keys(STORAGE_NAMESPACE.Networks)

    for (const key of keys) {
      const record = await legacy.get<INetworkConfigRecord>(STORAGE_NAMESPACE.Networks, key)

      if (record !== null) {
        await this.#storage.set(STORAGE_NAMESPACE.NetworksEncrypted, key, record)
      }

      await legacy.remove(STORAGE_NAMESPACE.Networks, key)
    }
  }

  async findByChainId(chainId: ChainId): Promise<INetworkConfig | null> {
    await this.#migrateLegacy()

    const record = await this.#storage.get<INetworkConfigRecord>(
      STORAGE_NAMESPACE.NetworksEncrypted,
      NetworkRepository.#keyOf(chainId),
    )

    return record === null ? null : fromRecord(record)
  }

  async save(config: INetworkConfig): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.NetworksEncrypted,
      NetworkRepository.#keyOf(config.chainId),
      toRecord(config),
    )
  }

  async delete(chainId: ChainId): Promise<void> {
    await this.#storage.remove(
      STORAGE_NAMESPACE.NetworksEncrypted,
      NetworkRepository.#keyOf(chainId),
    )
  }

  async getActiveChainId(): Promise<ChainId | null> {
    const stored = await this.#storage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.ActiveChainId,
    )

    if (stored === null) {
      return null
    }

    /* A value from storage is untrusted: it may have been written
       by another app version or corrupted. A bad id is treated as
       no selection, not as a reason to stop launch. */
    try {
      return toChainId(stored)
    } catch {
      return null
    }
  }

  async setActiveChainId(chainId: ChainId): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.ActiveChainId,
      chainId.toString(),
    )
  }

  static #keyOf(chainId: ChainId) {
    return toStorageKey(chainId.toString())
  }
}
