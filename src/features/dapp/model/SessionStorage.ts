import { STORAGE_NAMESPACE, toStorageKey, type ISecureStorage, type ILogger } from '@/core'

/**
 * Storage as the WalletConnect library expects it.
 *
 * Declared here, not taken from the package: a dependency for five
 * signatures is not worth it, and a dependency in a wallet is
 * another path to secrets.
 */
export interface IKeyValueStorage {
  getKeys(): Promise<string[]>
  getEntries<TValue = unknown>(): Promise<[string, TValue][]>
  getItem<TValue = unknown>(key: string): Promise<TValue | undefined>
  setItem<TValue = unknown>(key: string, value: TValue): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Connection storage on top of the encrypted store.
 *
 * WHY IT EXISTS. Not for the reason first assumed. The installed
 * library version opens its own IndexedDB and migrates old
 * `localStorage` rows into it; sessions survive reload, contrary
 * to the debt list. Verified by reading the shipped package, not
 * from memory.
 *
 * There are three real faults, and this replacement fixes all three.
 *
 * FIRST: RECORDS SIT IN PLAINTEXT. They hold the symmetric keys
 * that encrypt exchange with the app through the relay. Whoever
 * has them reads wallet–app traffic and can impersonate the wallet.
 * Here they are read only while unlocked.
 *
 * SECOND: THEY SURVIVE WALLET DELETION. The database belongs to
 * the library, our wipe does not touch it, and a new wallet on
 * the same device would inherit foreign connections. Here they
 * vanish with the wallet because they live in its store.
 *
 * THIRD: THEY ARE OUTSIDE OUR BOOKS. A password change re-encrypts
 * everything that belongs to the wallet; a foreign database stays
 * as it was.
 *
 * THE COST IS STATED PLAINLY: connections are now available only
 * while unlocked. For a section that already works only in an open
 * wallet that changes nothing, but an autolock mid-work makes
 * writes fail — see the debt.
 *
 * A LOCKED STORE IS NOT SILENCED ON WRITE AND IS SILENCED ON READ.
 * A write failure means a lost session — the library must learn.
 * A read failure while locked only means "unavailable now", and
 * an empty reply is more honest than an exception: the library
 * starts clean instead of breaking.
 */
export class SecureSessionStorage implements IKeyValueStorage {
  readonly #storage: ISecureStorage
  readonly #logger: ILogger

  constructor(storage: ISecureStorage, logger: ILogger) {
    this.#storage = storage
    this.#logger = logger.child('SessionStorage')
  }

  async getKeys(): Promise<string[]> {
    if (!this.#storage.isUnlocked) {
      return []
    }

    return [...(await this.#storage.keys(STORAGE_NAMESPACE.DappSessions))]
  }

  async getEntries<TValue = unknown>(): Promise<[string, TValue][]> {
    const entries: [string, TValue][] = []

    for (const key of await this.getKeys()) {
      const value = await this.getItem<TValue>(key)

      /* A key without a value is skipped, not returned as `undefined`:
         the library expects pairs, and a pair with an empty value
         breaks its state parse. */
      if (value !== undefined) {
        entries.push([key, value])
      }
    }

    return entries
  }

  async getItem<TValue = unknown>(key: string): Promise<TValue | undefined> {
    if (!this.#storage.isUnlocked) {
      return undefined
    }

    try {
      const value = await this.#storage.get<TValue>(
        STORAGE_NAMESPACE.DappSessions,
        toStorageKey(key),
      )

      /* The library expects a missing record as `undefined`;
         the store returns `null`. */
      return value ?? undefined
    } catch (error) {
      /* A corrupted record must not take down the whole section:
         the connection will be established again. */
      this.#logger.warn('A connection record could not be read', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return undefined
    }
  }

  async setItem<TValue = unknown>(key: string, value: TValue): Promise<void> {
    /* Exception outward: a silently lost record means a connection
       that will not survive reload — the fault this store exists
       to prevent. */
    await this.#storage.set(STORAGE_NAMESPACE.DappSessions, toStorageKey(key), value)
  }

  async removeItem(key: string): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.DappSessions, toStorageKey(key))
  }
}
