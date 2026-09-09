import { ConflictError } from '../lib/errors.ts'

import type { ISettingsRecord, ISettingsRepository } from './contracts.ts'

export interface IMemorySettingsOptions {
  /** Milliseconds after which an untouched record disappears. */
  readonly ttlMs: number

  /** Max records. At the limit the store refuses writes. */
  readonly maxRecords: number

  /** Clock. Injected so TTL is tested, not observed. */
  readonly now: () => Date
}

const DEFAULT_OPTIONS: IMemorySettingsOptions = {
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  maxRecords: 100_000,
  now: () => new Date(),
}

/**
 * In-process settings store.
 *
 * THIS IS NOT DURABLE STORAGE, ON PURPOSE. A restart wipes records.
 * That is acceptable because sync is a mirror: settings live on the
 * device, and the service only helps copy them to a second one. A
 * user who loses a record here loses nothing.
 *
 * Durable storage will arrive with a database choice; that is why
 * `ISettingsRepository` exists. The implementation is swapped in one
 * place — when the app is assembled.
 *
 * RECORD TTL IS BOUNDED. Abandoned ciphertext need not live forever:
 * it remains a target and does not help the owner.
 */
export class MemorySettingsRepository implements ISettingsRepository {
  readonly #records = new Map<string, ISettingsRecord>()
  readonly #options: IMemorySettingsOptions

  constructor(options: Partial<IMemorySettingsOptions> = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Stored-record count. For service observation. */
  get size(): number {
    return this.#records.size
  }

  get(syncId: string): Promise<ISettingsRecord | null> {
    const record = this.#records.get(syncId)

    if (record === undefined) {
      return Promise.resolve(null)
    }

    if (this.#isExpired(record)) {
      this.#records.delete(syncId)

      return Promise.resolve(null)
    }

    return Promise.resolve(record)
  }

  put(syncId: string, ciphertext: string, expectedRevision: number): Promise<ISettingsRecord> {
    const existing = this.#records.get(syncId)
    const current = existing !== undefined && !this.#isExpired(existing) ? existing : null

    /* Revision is checked before write: two devices writing at once
       would otherwise silently overwrite each other. */
    const currentRevision = current?.revision ?? 0

    if (expectedRevision !== currentRevision) {
      /* Refusal is a rejected promise, not a throw: a sync exception
         from a method declared to return `Promise` reaches the caller
         on another path, and `catch` around `await` will not see it. */
      return Promise.reject(
        new ConflictError(
          `Settings were changed by another device: expected revision ${String(expectedRevision)}, ` +
            `stored revision ${String(currentRevision)}.`,
        ),
      )
    }

    if (current === null && this.#records.size >= this.#options.maxRecords) {
      this.#collectExpired()

      if (this.#records.size >= this.#options.maxRecords) {
        return Promise.reject(new Error('Settings storage is full.'))
      }
    }

    const record: ISettingsRecord = {
      ciphertext,
      revision: currentRevision + 1,
      updatedAt: this.#options.now(),
    }

    this.#records.set(syncId, record)

    return Promise.resolve(record)
  }

  remove(syncId: string): Promise<void> {
    this.#records.delete(syncId)

    return Promise.resolve()
  }

  #isExpired(record: ISettingsRecord): boolean {
    return this.#options.now().getTime() - record.updatedAt.getTime() > this.#options.ttlMs
  }

  #collectExpired(): void {
    for (const [syncId, record] of this.#records) {
      if (this.#isExpired(record)) {
        this.#records.delete(syncId)
      }
    }
  }
}
