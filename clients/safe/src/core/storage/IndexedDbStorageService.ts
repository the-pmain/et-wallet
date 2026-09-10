import {
  MigrationFailedError,
  StorageReadFailedError,
  StorageUnavailableError,
  StorageWriteFailedError,
} from '@/core/errors'

import type { IStorageService } from './StorageService'
import {
  STORAGE_DURABILITY,
  STORAGE_NAMESPACE,
  type IStorageEstimate,
  type IStorageMigration,
  type IStorageTransaction,
  type StorageDurability,
  type StorageKey,
  type StorageNamespace,
} from './types'

/** Default database name. */
const DEFAULT_DATABASE_NAME = 'elmsafe'

/** Storage settings. */
export interface IIndexedDbStorageOptions {
  /**
   * Database name.
   *
   * Set for tests: each check uses its own database, otherwise they
   * would see each other's data.
   */
  readonly databaseName?: string

  /**
   * Schema-migration steps, in ascending version order.
   *
   * IMPLEMENTATION REQUIREMENT WHOSE VIOLATION IS INVISIBLE.
   * Inside a migration you may only await operations of this same
   * storage. Any other await — a network call, a timer, a file read —
   * releases the IndexedDB transaction: the browser commits it as soon
   * as the microtask queue is empty with no outstanding requests.
   * Later writes of that migration are silently lost.
   */
  readonly migrations?: readonly IStorageMigration[]
}

/**
 * Persistent storage on top of IndexedDB.
 *
 * WHY IndexedDB, NOT localStorage. The ban on `localStorage` has been
 * in the project from stage one and is an ESLint rule: it is
 * synchronous, stores only strings, is visible to any page script,
 * and is absent in a service-worker manifest v3. Another reason
 * matters here: IndexedDB serializes values by structured clone,
 * which **keeps `bigint` and `Uint8Array` lossless**. Through JSON,
 * wallet amounts would have to be encoded by hand, and a codec bug
 * would mean a silently corrupted balance.
 *
 * WHAT THIS LAYER DOES NOT DO: it does not encrypt. Encryption is
 * done by `SecureStorage` before write. Otherwise storage would start
 * deciding for itself what counts as a secret.
 *
 * OPENING IS LAZY AND ONCE. The database opens on first use, not via
 * a separate call at the entry point. The requirement "call `init`
 * before everyone else" is inevitably broken when a new consumer is
 * added, and the break shows up as empty storage — i.e. a lost
 * wallet. `init` stays available and idempotent for those who need
 * the database opened early.
 *
 * BROWSER STORAGE MAY BE CLEARED WITHOUT ASKING. When space is short
 * the browser may evict site data, and for a wallet that means losing
 * the encrypted seed phrase. So on open, persistent storage is
 * requested; the result is available via {@link durability} and must
 * be shown to the user if permission was not granted.
 */
export class IndexedDbStorageService implements IStorageService {
  readonly #databaseName: string
  readonly #migrations: readonly IStorageMigration[]
  readonly #schemaVersion: number

  #opening: Promise<IDBDatabase> | null = null

  /**
   * The browser promised not to evict the data.
   *
   * `false` until the database is opened and in environments where
   * the promise is unavailable.
   */
  #isPersistent = false

  constructor(options: IIndexedDbStorageOptions = {}) {
    this.#databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
    this.#migrations = [...(options.migrations ?? [])].sort(
      (left, right) => left.version - right.version,
    )

    /* Schema version is one above the last migration: version one is
       taken by creating stores, which is not a migration. */
    this.#schemaVersion =
      this.#migrations.reduce((maximum, migration) => Math.max(maximum, migration.version), 0) + 1
  }

  async init(): Promise<void> {
    await this.#open()
  }

  async get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
    try {
      /* IndexedDB returns the value as `any`: it does not know the
         record contents. Narrowing to `unknown` returns type checking
         to the caller, instead of silently accepting anything. */
      const value: unknown = await this.#read<unknown>(namespace, (store) => store.get(key))

      return value === undefined ? null : (value as TValue)
    } catch (error) {
      throw new StorageReadFailedError(key, { cause: error })
    }
  }

  async set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void> {
    try {
      await this.#write(namespace, (store) => store.put(value, key))
    } catch (error) {
      throw new StorageWriteFailedError(key, { cause: error })
    }
  }

  async remove(namespace: StorageNamespace, key: StorageKey): Promise<void> {
    try {
      await this.#write(namespace, (store) => store.delete(key))
    } catch (error) {
      throw new StorageWriteFailedError(key, { cause: error })
    }
  }

  async has(namespace: StorageNamespace, key: StorageKey): Promise<boolean> {
    try {
      /* The key is read, not the value: a wallet record can be
         kilobytes, and there is no need to decrypt it just to check
         that it exists. */
      return (await this.#read(namespace, (store) => store.getKey(key))) !== undefined
    } catch (error) {
      throw new StorageReadFailedError(key, { cause: error })
    }
  }

  async keys(namespace: StorageNamespace): Promise<readonly StorageKey[]> {
    try {
      const found = await this.#read(namespace, (store) => store.getAllKeys())

      return found.map(toStorageKeyFromIdb)
    } catch (error) {
      throw new StorageReadFailedError(namespace, { cause: error })
    }
  }

  async clear(namespace: StorageNamespace): Promise<void> {
    try {
      await this.#write(namespace, (store) => store.clear())
    } catch (error) {
      throw new StorageWriteFailedError(namespace, { cause: error })
    }
  }

  /**
   * Runs operations atomically.
   *
   * IndexedDB ITSELF ROLLS BACK. An exception inside the handler
   * causes `abort`, and writes made before it are not saved. No
   * snapshot of our own is taken: it would be an in-memory copy and
   * would drift from the database under a concurrent write.
   *
   * Same limit as migrations: inside the handler you may only await
   * operations of this storage.
   */
  async transaction<TResult>(
    namespaces: readonly StorageNamespace[],
    handler: (transaction: IStorageTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const database = await this.#open()
    const transaction = database.transaction([...namespaces], 'readwrite')
    const completion = trackCompletion(transaction)

    let result: TResult

    try {
      result = await handler(wrapTransaction(transaction))
    } catch (error) {
      /* The completion promise is swallowed before abort: `abort`
         will reject it, and nobody waits for it here — the original
         cause goes out. An unnoticed rejected promise in the browser
         fires `unhandledrejection`, and in Node can crash the process. */
      completion.catch(() => undefined)
      abortQuietly(transaction)

      throw error
    }

    await completion

    return result
  }

  async estimate(): Promise<IStorageEstimate | null> {
    const storage: StorageManager | undefined = globalThis.navigator?.storage

    if (storage === undefined || typeof storage.estimate !== 'function') {
      return null
    }

    const { usage, quota } = await storage.estimate()

    /* "Unknown" is not replaced with zero: zero used space and a lack
       of information are different statements, and showing the second
       as the first reassures without grounds. */
    return usage === undefined || quota === undefined ? null : { usage, quota }
  }

  /**
   * How reliably storage holds data.
   *
   * The database is opened if it is not already: persistent-storage
   * permission is requested there, and answering before that would
   * scare the owner with a state that is already gone.
   */
  async durability(): Promise<StorageDurability> {
    await this.#open()

    return this.#isPersistent ? STORAGE_DURABILITY.Persistent : STORAGE_DURABILITY.BestEffort
  }

  async destroy(): Promise<void> {
    const database = await this.#open().catch(() => null)

    database?.close()
    this.#opening = null

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(this.#databaseName)

      request.onsuccess = () => {
        resolve()
      }
      request.onerror = () => {
        reject(
          new StorageUnavailableError('the database was not deleted', { cause: request.error }),
        )
      }
      /* Deletion waits for every connection to close. Another tab
         holding the database open will block it — that is not an
         error, it is a reason that must be named. */
      request.onblocked = () => {
        reject(
          new StorageUnavailableError(
            'the database is open in another tab; close it and repeat the reset',
          ),
        )
      }
    })
  }

  /** Opens the database, creating stores and running migrations. */
  async #open(): Promise<IDBDatabase> {
    this.#opening ??= this.#openOnce()

    try {
      return await this.#opening
    } catch (error) {
      /* A failed open is not remembered: the next attempt must open
         the database again, not receive a stored refusal. */
      this.#opening = null

      throw error
    }
  }

  async #openOnce(): Promise<IDBDatabase> {
    if (globalThis.indexedDB === undefined) {
      throw new StorageUnavailableError('IndexedDB is unavailable in this environment')
    }

    await this.#requestPersistence()

    try {
      return await this.#openAtVersion(this.#schemaVersion)
    } catch (error) {
      if (!isVersionTooLow(error)) {
        throw error
      }

      /*
        THE ACTUAL VERSION HAS MOVED PAST OURS.

        Our version is derived from the number of migrations, and the
        database may have gone higher — for example when a store was
        added without a migration, or after a newer build ran. Asking
        for a lower version is rejected wholesale by the browser, and
        the wallet stopped opening: the first launch repaired the
        schema and raised the version, the second asked for the old
        one and was refused.

        Lowering the version is impossible and unnecessary: a database
        with extra stores still works. Open the one that is there.
      */
      return await this.#openAtVersion(null)
    }
  }

  /**
   * Opens the database at the given version.
   *
   * @param version `null` — open at the existing version.
   */
  async #openAtVersion(version: number | null): Promise<IDBDatabase> {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request =
        version === null
          ? globalThis.indexedDB.open(this.#databaseName)
          : globalThis.indexedDB.open(this.#databaseName, version)

      request.onupgradeneeded = (event) => {
        const database = request.result
        const upgrade = request.transaction

        for (const namespace of Object.values(STORAGE_NAMESPACE)) {
          if (!database.objectStoreNames.contains(namespace)) {
            database.createObjectStore(namespace)
          }
        }

        if (upgrade === null) {
          return
        }

        this.#runMigrations(upgrade, event.oldVersion).catch((error: unknown) => {
          abortQuietly(upgrade)
          reject(
            error instanceof Error
              ? error
              : new StorageUnavailableError('the schema migration was not performed', {
                  cause: error,
                }),
          )
        })
      }

      request.onsuccess = () => {
        const database = request.result

        /* Another tab updated the schema: keeping a connection on the
           old version open is not allowed — it would block the upgrade. */
        database.onversionchange = () => {
          database.close()
          this.#opening = null
        }

        /*
          A DATABASE CREATED BY AN OLDER BUILD MAY LACK NEW STORES.

          The store list is derived from the namespace list, and the
          schema version from the number of migrations. Adding a
          namespace without a migration left the version unchanged,
          and `onupgradeneeded` did not fire on an existing database:
          the store was not created, and reading from it failed. The
          wallet stopped opening for everyone who had used it before
          the update — and only for them, so a fresh database looked
          fine.

          Here the shortage is detected and repaired: the database is
          reopened at the next version, and stores are created the
          usual way. Relying on people not forgetting the version is
          not enough — that is exactly how they forget.
        */
        const hasAllStores = [...Object.values(STORAGE_NAMESPACE)].every((namespace) =>
          database.objectStoreNames.contains(namespace),
        )

        if (hasAllStores && database.version >= this.#schemaVersion) {
          resolve(database)

          return
        }

        /* Version only grows: it cannot be lowered, but taking the
           existing one and adding one always works. */
        const target = Math.max(database.version + 1, this.#schemaVersion)

        database.close()
        this.#openAtVersion(target).then(resolve, reject)
      }

      request.onerror = () => {
        reject(
          new StorageUnavailableError('the database could not be opened', {
            cause: request.error,
          }),
        )
      }

      request.onblocked = () => {
        reject(
          new StorageUnavailableError(
            'the schema upgrade is blocked by another tab; close it and reload the page',
          ),
        )
      }
    })
  }

  /** Runs unapplied migration steps in the upgrade transaction. */
  async #runMigrations(upgrade: IDBTransaction, fromVersion: number): Promise<void> {
    const wrapped = wrapTransaction(upgrade)

    for (const migration of this.#migrations) {
      if (migration.version <= fromVersion) {
        continue
      }

      try {
        await migration.migrate(wrapped)
      } catch (error) {
        throw new MigrationFailedError(migration.version, { cause: error })
      }
    }
  }

  /**
   * Asks the browser not to evict the data.
   *
   * A refusal is not an error: in a private window and without user
   * interaction the permission is not granted, and the wallet must
   * still work there. The result is remembered so the UI can warn.
   */
  async #requestPersistence(): Promise<void> {
    const storage: StorageManager | undefined = globalThis.navigator?.storage

    if (storage === undefined || typeof storage.persist !== 'function') {
      return
    }

    try {
      this.#isPersistent = (await storage.persisted()) || (await storage.persist())
    } catch {
      this.#isPersistent = false
    }
  }

  /** Reads from one store. */
  async #read<TResult>(
    namespace: StorageNamespace,
    operation: (store: IDBObjectStore) => IDBRequest<TResult>,
  ): Promise<TResult> {
    const database = await this.#open()
    const transaction = database.transaction(namespace, 'readonly')

    return await promisify(operation(transaction.objectStore(namespace)))
  }

  /** Writes to one store and waits for the transaction to finish. */
  async #write(
    namespace: StorageNamespace,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    const database = await this.#open()
    const transaction = database.transaction(namespace, 'readwrite')
    const completion = trackCompletion(transaction)

    await promisify(operation(transaction.objectStore(namespace)))

    /* Wait for the transaction to finish, not just the request: a
       successful request does not yet mean the data is written — the
       transaction may still be aborted for quota. */
    await completion
  }
}

/**
 * Turns an IndexedDB key into a storage key.
 *
 * Storage uses only string keys — they are produced by `toStorageKey`.
 * Numbers, dates, and composite keys, which IndexedDB allows, cannot
 * appear here, and blindly stringifying them would yield
 * `[object Object]` instead of a record name.
 */
function toStorageKeyFromIdb(key: IDBValidKey): StorageKey {
  if (typeof key !== 'string') {
    throw new StorageUnavailableError(`a non-string record key: ${typeof key}`)
  }

  return key as StorageKey
}

/** Turns an IndexedDB request into a promise. */
async function promisify<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
  return await new Promise<TResult>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('The storage request was rejected without a reason.'))
    }
  })
}

/**
 * Promise of transaction completion.
 *
 * Created BEFORE the first operation: handlers assigned after the
 * transaction finishes will never fire, and the wait would hang.
 */
function trackCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('The storage transaction was rejected.'))
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('The storage transaction was aborted.'))
    }
  })
}

/**
 * Aborts a transaction without hiding the original cause.
 *
 * `abort` throws if the transaction is already finished. That error
 * has nothing to do with why we were rolling back, and it must not
 * replace the real cause.
 */
function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch {
    /* The transaction is already closed — nothing to roll back. */
  }
}

/** Wraps an IndexedDB transaction in the storage contract. */
function wrapTransaction(transaction: IDBTransaction): IStorageTransaction {
  const store = (namespace: StorageNamespace): IDBObjectStore => transaction.objectStore(namespace)

  return {
    async get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
      const value: unknown = await promisify<unknown>(store(namespace).get(key))

      return value === undefined ? null : (value as TValue)
    },

    async set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void> {
      await promisify(store(namespace).put(value, key))
    },

    async remove(namespace: StorageNamespace, key: StorageKey): Promise<void> {
      await promisify(store(namespace).delete(key))
    },

    async keys(namespace: StorageNamespace): Promise<readonly StorageKey[]> {
      const found = await promisify(store(namespace).getAllKeys())

      return found.map(toStorageKeyFromIdb)
    },

    async clear(namespace: StorageNamespace): Promise<void> {
      await promisify(store(namespace).clear())
    },
  }
}

/**
 * Refusal "the requested version is lower than the existing one".
 *
 * A distinct case, not a generic open failure: it means a database
 * created by a newer build or already repaired, and it can be used —
 * unlike a corrupted or unavailable one.
 */
function isVersionTooLow(error: unknown): boolean {
  const cause = error instanceof StorageUnavailableError ? error.cause : error

  return cause instanceof DOMException && cause.name === 'VersionError'
}
