import {
  STORAGE_NAMESPACE,
  toStorageKey,
  type StorageKey,
  type StorageNamespace,
} from '@/core/storage'
import type { Timestamp } from '@/core/types'

import type { IExportAuditLog } from './contracts'
import type { ExportKind, ExportRisk, ExportScope, IExportRecord } from './types'

/**
 * The slice of storage the log needs.
 *
 * WHY NOT THE WHOLE `IStorageService`. The log uses three methods out
 * of ten, and requiring the full interface would forbid putting the
 * log in encrypted storage: `ISecureStorage` has no migrations,
 * transactions, or size estimates — and must not.
 *
 * Log records hold no secrets, but they tell an observer with disk
 * access that the owner dumped the seed phrase and when. Narrowing
 * the dependency to what is actually used lets the log live encrypted
 * without breaking existing callers.
 */
export interface IExportAuditStorage {
  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>
  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>
  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>
}

/**
 * On-disk record shape.
 *
 * Scope is not duplicated inside the record: it is the key.
 * Times are numbers — serialisable by any backend.
 */
interface IExportRecordEntry {
  readonly kind: string
  readonly addressIndex: number | null
  readonly risk: string
  readonly at: number
}

/**
 * Export log on top of abstract storage.
 *
 * All records of one account sit under one key as an array. Reason:
 * there are a handful per account, and the whole history is needed
 * on every risk assessment. A key per record would mean scanning the
 * whole namespace on every check.
 */
export class ExportAuditLog implements IExportAuditLog {
  readonly #storage: IExportAuditStorage

  constructor(storage: IExportAuditStorage) {
    this.#storage = storage
  }

  async record(entry: IExportRecord): Promise<void> {
    const key = ExportAuditLog.#keyOf(entry.scope)
    const existing = await this.#read(key)

    /* Newest first: history is read newest-to-oldest, and sorting on
       every read would be extra work. */
    const updated: IExportRecordEntry[] = [
      {
        kind: entry.kind,
        addressIndex: entry.addressIndex,
        risk: entry.risk,
        at: entry.at,
      },
      ...existing,
    ]

    await this.#storage.set(STORAGE_NAMESPACE.ExportAudit, key, updated)
  }

  async listByScope(scope: ExportScope): Promise<readonly IExportRecord[]> {
    const entries = await this.#read(ExportAuditLog.#keyOf(scope))

    return entries.map((entry) => ({
      kind: entry.kind as ExportKind,
      scope,
      addressIndex: entry.addressIndex,
      risk: entry.risk as ExportRisk,
      at: entry.at as Timestamp,
    }))
  }

  async hasExported(scope: ExportScope, kind: ExportKind): Promise<boolean> {
    const entries = await this.#read(ExportAuditLog.#keyOf(scope))

    return entries.some((entry) => entry.kind === kind)
  }

  async clear(scope: ExportScope): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.ExportAudit, ExportAuditLog.#keyOf(scope))
  }

  async #read(key: StorageKey): Promise<readonly IExportRecordEntry[]> {
    const stored = await this.#storage.get<IExportRecordEntry[]>(STORAGE_NAMESPACE.ExportAudit, key)

    return stored ?? []
  }

  static #keyOf(scope: ExportScope): StorageKey {
    return toStorageKey(scope)
  }
}
