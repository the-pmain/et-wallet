import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { MigrationFailedError } from '@/core/errors'

import { IndexedDbStorageService } from './IndexedDbStorageService'
import { toStorageKey } from './StorageKeys'
import { STORAGE_NAMESPACE, type IStorageMigration } from './types'

const KEY = toStorageKey('probe')
const OTHER_KEY = toStorageKey('second')

/**
 * Each check uses its own database.
 *
 * A shared database would mean checks see each other's records and
 * the order they run in would affect the result.
 */
let databaseNumber = 0

function createStorage(migrations?: readonly IStorageMigration[]): IndexedDbStorageService {
  databaseNumber += 1

  return new IndexedDbStorageService({
    databaseName: `test-${String(databaseNumber)}`,
    ...(migrations === undefined ? {} : { migrations }),
  })
}

let storage: IndexedDbStorageService

beforeEach(() => {
  storage = createStorage()
})

describe('IndexedDbStorageService: read and write', () => {
  it('returns the written value', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, { value: 42 })

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toEqual({ value: 42 })
  })

  it('a missing record yields null, not an exception', async () => {
    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBeNull()
  })

  it('a later write replaces the value', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'first')
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'second')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('second')
  })

  it('remove deletes the record', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'value')
    await storage.remove(STORAGE_NAMESPACE.Settings, KEY)

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBeNull()
  })

  it('has distinguishes presence from absence', async () => {
    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(false)

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'value')

    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(true)
  })

  it('has does not treat a stored null as absence', async () => {
    /* `null` is a stored value, not an empty slot. Mixing those cases
       in a wallet would mean "setting is unset" where it was set
       explicitly. */
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, null)

    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(true)
  })

  it('lists keys of a namespace', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 1)
    await storage.set(STORAGE_NAMESPACE.Settings, OTHER_KEY, 2)

    await expect(storage.keys(STORAGE_NAMESPACE.Settings)).resolves.toEqual(
      expect.arrayContaining([KEY, OTHER_KEY]),
    )
  })

  it('clears one namespace without touching others', async () => {
    /* Clearing the balance cache must not touch the key vault. */
    await storage.set(STORAGE_NAMESPACE.BalanceCache, KEY, 'cache')
    await storage.set(STORAGE_NAMESPACE.Vault, KEY, 'secret')

    await storage.clear(STORAGE_NAMESPACE.BalanceCache)

    await expect(storage.get(STORAGE_NAMESPACE.BalanceCache, KEY)).resolves.toBeNull()
    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('secret')
  })

  it('the same keys in different namespaces do not collide', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'setting')
    await storage.set(STORAGE_NAMESPACE.Accounts, KEY, 'account')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('setting')
    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('account')
  })
})

describe('IndexedDbStorageService: wallet value types', () => {
  it('stores bigint without losing precision', async () => {
    /* Wallet amounts are `bigint`. Through JSON they would have to be
       encoded by hand, and casting to `number` silently corrupts the
       value from 2^53. IndexedDB structured clone keeps them as-is. */
    const huge = 2n ** 200n + 12345n

    await storage.set(STORAGE_NAMESPACE.Transactions, KEY, { value: huge })

    const read = await storage.get<{ value: bigint }>(STORAGE_NAMESPACE.Transactions, KEY)

    expect(read?.value).toBe(huge)
    expect(typeof read?.value).toBe('bigint')
  })

  it('stores binary data', async () => {
    /* Salt, IV, and ciphertext are byte arrays. */
    const bytes = new Uint8Array([0, 1, 2, 255])

    await storage.set(STORAGE_NAMESPACE.Vault, KEY, bytes)

    const read = await storage.get<Uint8Array>(STORAGE_NAMESPACE.Vault, KEY)

    expect([...(read ?? [])]).toEqual([0, 1, 2, 255])
  })

  it('returns a copy, not a reference to the written object', async () => {
    /* Real storage serializes the value. An implementation that
       returned the same reference would hide shared-state bugs. */
    const written = { nested: { number: 1 } }

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, written)
    written.nested.number = 2

    const read = await storage.get<typeof written>(STORAGE_NAMESPACE.Settings, KEY)

    expect(read?.nested.number).toBe(1)
  })
})

describe('IndexedDbStorageService: durability across sessions', () => {
  it('data survives recreating the object', async () => {
    /* The main property of persistent storage and the only reason it
       replaced in-memory storage. */
    const name = `test-survival-${String(databaseNumber)}`
    const first = new IndexedDbStorageService({ databaseName: name })

    await first.set(STORAGE_NAMESPACE.Vault, KEY, 'encrypted phrase')

    const second = new IndexedDbStorageService({ databaseName: name })

    await expect(second.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('encrypted phrase')
  })

  it('destroy deletes everything', async () => {
    await storage.set(STORAGE_NAMESPACE.Vault, KEY, 'secret')
    await storage.destroy()

    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBeNull()
  })
})

describe('IndexedDbStorageService: transactions', () => {
  it('transaction writes are visible after it finishes', async () => {
    await storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
      await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'first')
      await transaction.set(STORAGE_NAMESPACE.Accounts, OTHER_KEY, 'second')
    })

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('first')
    await expect(storage.get(STORAGE_NAMESPACE.Accounts, OTHER_KEY)).resolves.toBe('second')
  })

  it('an exception rolls back every write of the transaction', async () => {
    /* Adding an account changes both the key vault and the account
       list. Writing only one of the two leaves the wallet
       inconsistent: the account is visible and there is nothing to
       sign with. */
    await expect(
      storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'written')

        throw new Error('failure mid-write')
      }),
    ).rejects.toThrow('failure mid-write')

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBeNull()
  })

  it('rollback does not touch writes made before the transaction', async () => {
    await storage.set(STORAGE_NAMESPACE.Accounts, OTHER_KEY, 'previous')

    await expect(
      storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'new')

        throw new Error('failure')
      }),
    ).rejects.toThrow()

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, OTHER_KEY)).resolves.toBe('previous')
  })

  it('a transaction spans several namespaces', async () => {
    await storage.transaction(
      [STORAGE_NAMESPACE.Accounts, STORAGE_NAMESPACE.Vault],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'account')
        await transaction.set(STORAGE_NAMESPACE.Vault, KEY, 'key')
      },
    )

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('account')
    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('key')
  })

  it('a transaction returns the handler result', async () => {
    const result = await storage.transaction(
      [STORAGE_NAMESPACE.Settings],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 7)

        return 'done'
      },
    )

    expect(result).toBe('done')
  })

  it('a read inside a transaction sees its own writes', async () => {
    const read = await storage.transaction(
      [STORAGE_NAMESPACE.Settings],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'inside')

        return await transaction.get<string>(STORAGE_NAMESPACE.Settings, KEY)
      },
    )

    expect(read).toBe('inside')
  })
})

describe('IndexedDbStorageService: migrations', () => {
  it('runs a step on first open', async () => {
    const migrated = createStorage([
      {
        version: 1,
        description: 'fills the default setting',
        migrate: async (transaction) => {
          await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'from migration')
        },
      },
    ])

    await migrated.init()

    await expect(migrated.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('from migration')
  })

  it('does not run a step twice', async () => {
    /* Interrupting the browser mid-upgrade must not re-apply an
       irreversible change. */
    const name = `test-migration-${String(databaseNumber)}`
    let calls = 0

    const step: IStorageMigration = {
      version: 1,
      description: 'counts calls',
      migrate: async (transaction) => {
        calls += 1
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, calls)
      },
    }

    await new IndexedDbStorageService({ databaseName: name, migrations: [step] }).init()
    await new IndexedDbStorageService({ databaseName: name, migrations: [step] }).init()

    expect(calls).toBe(1)
  })

  it('a failed migration leaves no partial changes', async () => {
    const migrated = createStorage([
      {
        version: 1,
        description: 'fails mid-work',
        migrate: async (transaction) => {
          await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'partial')

          throw new Error('data was not parsed')
        },
      },
    ])

    await expect(migrated.init()).rejects.toThrow(MigrationFailedError)
  })

  it('steps run in ascending version order', async () => {
    const order: number[] = []

    const migrated = createStorage([
      {
        version: 2,
        description: 'second',
        migrate: () => {
          order.push(2)

          return Promise.resolve()
        },
      },
      {
        version: 1,
        description: 'first',
        migrate: () => {
          order.push(1)

          return Promise.resolve()
        },
      },
    ])

    await migrated.init()

    expect(order).toEqual([1, 2])
  })
})

describe('IndexedDbStorageService: open', () => {
  it('a second init does not reopen the database', async () => {
    await storage.init()

    await expect(storage.init()).resolves.toBeUndefined()
  })

  it('works without an explicit init', async () => {
    /* The requirement "call init before everyone else" is broken when
       a new consumer is added, and the break looks like empty storage
       — i.e. a wallet that lost its data. */
    await expect(storage.set(STORAGE_NAMESPACE.Settings, KEY, 'without init')).resolves.toBeUndefined()
    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('without init')
  })
})

describe('IndexedDbStorageService: database from an older build', () => {
  it('a missing store is created instead of causing a failure', async () => {
    /*
      THIS HAPPENED LIVE. A namespace was added to the list, and the
      schema version is derived from the number of migrations and
      stayed the same: on a database created by the previous build
      `onupgradeneeded` did not fire, the store did not appear, and
      the wallet stopped opening — for everyone who had used it
      before, and only for them. On a fresh database everything
      looked fine, so no earlier test showed this.
    */
    const name = `old-database-${String(Date.now())}`

    /* Database of the previous build: one store of many. */
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(name, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        request.result.close()
        resolve()
      }

      request.onerror = () => {
        reject(request.error ?? new Error('the database did not open'))
      }
    })

    const updated = new IndexedDbStorageService({ databaseName: name })

    await updated.set(STORAGE_NAMESPACE.NetworksEncrypted, KEY, 'value')

    await expect(updated.get(STORAGE_NAMESPACE.NetworksEncrypted, KEY)).resolves.toBe(
      'value',
    )
  })

  it('data from the older build is not lost', async () => {
    /* Recreating the database wholesale would be simplest and would
       mean losing the encrypted phrase: it cannot be restored without
       the seed phrase. */
    const name = `old-database-with-data-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(name, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        const database = request.result
        const store = database
          .transaction(STORAGE_NAMESPACE.Settings, 'readwrite')
          .objectStore(STORAGE_NAMESPACE.Settings)

        store.put('old value', KEY)

        store.transaction.oncomplete = () => {
          database.close()
          resolve()
        }
      }

      request.onerror = () => {
        reject(request.error ?? new Error('the database did not open'))
      }
    })

    const updated = new IndexedDbStorageService({ databaseName: name })

    await expect(updated.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('old value')
  })
})

describe('IndexedDbStorageService: reopen after a repair', () => {
  it('a second launch after a schema repair opens', async () => {
    /*
      THIS IS THE SECOND HALF OF THE SAME BUG, AND ONE CHECK DID NOT
      CATCH IT. Repairing a missing store raises the database version.
      Our schema version is derived from the number of migrations and
      stays the same, so the next launch asked for a version lower
      than the existing one — and the browser rejects that request
      wholesale. The first launch was healed, the second stopped
      opening.
    */
    const name = `repaired-database-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(name, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        request.result.close()
        resolve()
      }

      request.onerror = () => {
        reject(request.error ?? new Error('the database did not open'))
      }
    })

    /* First launch: missing stores are created, the version grows. */
    const first = new IndexedDbStorageService({ databaseName: name })

    await first.set(STORAGE_NAMESPACE.NetworksEncrypted, KEY, 'value')

    /* Second launch — a new instance, as after a page reload. */
    const second = new IndexedDbStorageService({ databaseName: name })

    await expect(second.get(STORAGE_NAMESPACE.NetworksEncrypted, KEY)).resolves.toBe('value')
  })

  it('a newer-version database opens without being lowered', async () => {
    /* The version may have moved ahead for another reason — for
       example a build newer than the installed one. It cannot be
       lowered, and it can still be used. */
    const name = `future-database-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(name, 7)

      request.onupgradeneeded = () => {
        for (const namespace of Object.values(STORAGE_NAMESPACE)) {
          request.result.createObjectStore(namespace)
        }
      }

      request.onsuccess = () => {
        request.result.close()
        resolve()
      }

      request.onerror = () => {
        reject(request.error ?? new Error('the database did not open'))
      }
    })

    const storage = new IndexedDbStorageService({ databaseName: name })

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'works')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('works')
  })
})
