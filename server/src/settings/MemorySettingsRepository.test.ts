import { beforeEach, describe, expect, it } from 'vitest'

import { ConflictError } from '../lib/errors.ts'

import { MemorySettingsRepository } from './MemorySettingsRepository.ts'

const SYNC_ID = 'a'.repeat(64)
const OTHER_ID = 'b'.repeat(64)

/** Controllable clock: record TTL must be tested, not observed. */
let now: Date
let repository: MemorySettingsRepository

const TTL_MS = 1000

beforeEach(() => {
  now = new Date('2026-07-31T00:00:00.000Z')
  repository = new MemorySettingsRepository({ ttlMs: TTL_MS, now: () => now })
})

describe('Settings store: read and write', () => {
  it('returns null for an unknown id', async () => {
    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('stores ciphertext unchanged', async () => {
    /* The service does not parse the contents and has no code that
       can decrypt them: what arrived is what is stored. */
    await repository.put(SYNC_ID, 'c2VjcmV0', 0)

    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('c2VjcmV0')
  })

  it('starts revision numbering at one', async () => {
    const record = await repository.put(SYNC_ID, 'YQ==', 0)

    expect(record.revision).toBe(1)
  })

  it('increments the revision on every write', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    const second = await repository.put(SYNC_ID, 'Yg==', 1)

    expect(second.revision).toBe(2)
  })

  it('separates records of different ids', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    await repository.put(OTHER_ID, 'Yg==', 0)

    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('YQ==')
    expect((await repository.get(OTHER_ID))?.ciphertext).toBe('Yg==')
  })
})

describe('Settings store: concurrent write', () => {
  it('rejects a write with a stale revision', async () => {
    /* Two devices writing at once would otherwise silently overwrite
       each other. */
    await repository.put(SYNC_ID, 'YQ==', 0)

    await expect(repository.put(SYNC_ID, 'Yg==', 0)).rejects.toBeInstanceOf(ConflictError)
  })

  it('rejects a first write with a revision above zero', async () => {
    await expect(repository.put(SYNC_ID, 'YQ==', 5)).rejects.toBeInstanceOf(ConflictError)
  })

  it('does not change stored data on refusal', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)

    await expect(repository.put(SYNC_ID, 'Yg==', 0)).rejects.toBeInstanceOf(ConflictError)
    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('YQ==')
  })
})

describe('Settings store: TTL', () => {
  it('forgets a record after TTL', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('after TTL a write starts over', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    const record = await repository.put(SYNC_ID, 'Yg==', 0)

    expect(record.revision).toBe(1)
  })
})

describe('Settings store: delete', () => {
  it('deletes the record', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    await repository.remove(SYNC_ID)

    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('deleting a missing record is not an error', async () => {
    /* Otherwise the response would tell someone guessing the id
       whether a record exists. */
    await expect(repository.remove(SYNC_ID)).resolves.toBeUndefined()
  })
})

describe('Settings store: size limit', () => {
  it('refuses when the limit is reached', async () => {
    const small = new MemorySettingsRepository({ maxRecords: 1, ttlMs: TTL_MS, now: () => now })

    await small.put(SYNC_ID, 'YQ==', 0)

    await expect(small.put(OTHER_ID, 'Yg==', 0)).rejects.toThrow(/full/u)
  })

  it('frees space by dropping expired records', async () => {
    const small = new MemorySettingsRepository({ maxRecords: 1, ttlMs: TTL_MS, now: () => now })

    await small.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    await expect(small.put(OTHER_ID, 'Yg==', 0)).resolves.toMatchObject({ revision: 1 })
  })
})
