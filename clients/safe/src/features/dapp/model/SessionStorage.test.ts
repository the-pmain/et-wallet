import { beforeEach, describe, expect, it } from 'vitest'

import { SecureStorage, STORAGE_NAMESPACE, toStorageKey } from '@/core'
import { FastEncryptionService, InMemoryStorageService, NullLogger } from '@/test/doubles'

import { SecureSessionStorage } from './SessionStorage'

const PASSWORD = 'Korova-7-Luna!'

const SESSION_RECORD = {
  topic: 'a'.repeat(64),
  /* This field is why the namespace is encrypted: it encrypts
     exchange with the app through the relay. */
  symKey: 'b'.repeat(64),
  expiry: 1_800_000_000,
}

let underlying: InMemoryStorageService
let secure: SecureStorage
let storage: SecureSessionStorage

beforeEach(async () => {
  underlying = new InMemoryStorageService()
  secure = new SecureStorage(underlying, new FastEncryptionService())

  await secure.initialize(PASSWORD)

  storage = new SecureSessionStorage(secure, new NullLogger())
})

describe('Connection storage: surviving reload', () => {
  it('reads back what was written', async () => {
    /* Replacing the library's own store must keep its main property:
       the connection survives reload. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    expect(await storage.getItem('wc@2:client:session')).toEqual(SESSION_RECORD)
  })

  it('returns the full key list', async () => {
    await storage.setItem('first', 1)
    await storage.setItem('second', 2)

    expect((await storage.getKeys()).sort()).toEqual(['first', 'second'])
  })

  it('returns key-value pairs together', async () => {
    await storage.setItem('key', SESSION_RECORD)

    expect(await storage.getEntries()).toEqual([['key', SESSION_RECORD]])
  })

  it('removed items disappear', async () => {
    await storage.setItem('key', SESSION_RECORD)
    await storage.removeItem('key')

    expect(await storage.getItem('key')).toBeUndefined()
    expect(await storage.getKeys()).toEqual([])
  })

  it('a missing item is read as `undefined`, not `null`', async () => {
    /* The library distinguishes these: it treats `null` as a stored
       value and parses it as session state. */
    expect(await storage.getItem('never written')).toBeUndefined()
  })
})

describe('Connection storage: secrets', () => {
  it('the session key does not sit in the database as plaintext', async () => {
    /* Whoever has it reads wallet–app traffic and can impersonate
       the wallet. In the library's own database it sits in plaintext. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    const raw = JSON.stringify(
      await underlying.get(STORAGE_NAMESPACE.DappSessions, toStorageKey('wc@2:client:session')),
    )

    expect(raw).not.toContain(SESSION_RECORD.symKey)
    expect(raw).not.toContain(SESSION_RECORD.topic)
  })

  it('deleting the wallet takes connections with it', async () => {
    /* If they stayed, a new wallet on the same device would inherit
       foreign sessions. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    await secure.destroy()
    await secure.initialize(PASSWORD)

    expect(await storage.getKeys()).toEqual([])
  })
})

describe('Connection storage: locked wallet', () => {
  it('a read while locked returns empty instead of throwing', async () => {
    /* "Unavailable now" is more honest than an exception: the
       library starts clean instead of breaking mid-work. */
    await storage.setItem('key', SESSION_RECORD)

    secure.lock()

    expect(await storage.getKeys()).toEqual([])
    expect(await storage.getItem('key')).toBeUndefined()
    expect(await storage.getEntries()).toEqual([])
  })

  it('a write while locked fails loudly', async () => {
    /* A silently lost record means a connection that will not
       survive reload — the fault this store exists to prevent. */
    secure.lock()

    await expect(storage.setItem('key', SESSION_RECORD)).rejects.toThrow()
  })

  it('written data is still there after unlock', async () => {
    await storage.setItem('key', SESSION_RECORD)

    secure.lock()
    await secure.unlock(PASSWORD)

    expect(await storage.getItem('key')).toEqual(SESSION_RECORD)
  })
})

describe('Connection storage: corrupted record', () => {
  it('an unreadable record does not take down the whole section', async () => {
    /* The connection will be established again; failing the whole
       section over one record is a disproportionate cost. */
    await storage.setItem('intact', SESSION_RECORD)
    await underlying.set(STORAGE_NAMESPACE.DappSessions, toStorageKey('broken'), 'not ciphertext')

    const entries = await storage.getEntries()

    expect(await storage.getItem('broken')).toBeUndefined()
    expect(entries).toEqual([['intact', SESSION_RECORD]])
  })
})
