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
 * Часть хранилища, нужная журналу.
 *
 * ПОЧЕМУ НЕ `IStorageService` ЦЕЛИКОМ. Журналу требуются три метода
 * из десяти, а требование полного интерфейса запрещало бы класть журнал
 * в зашифрованное хранилище: `ISecureStorage` не умеет ни миграций,
 * ни транзакций, ни оценки объёма — и не должен уметь.
 *
 * Записи журнала секретов не содержат, но сообщают наблюдателю с доступом
 * к диску, что владелец выгружал seed-фразу и когда именно. Сузив
 * зависимость до фактически используемого, мы получаем возможность
 * хранить журнал зашифрованным, ничего не ломая существующим вызывающим.
 */
export interface IExportAuditStorage {
  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>
  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>
  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>
}

/**
 * Представление записи в хранилище.
 *
 * Область не дублируется внутри записи: она служит ключом.
 * Времена хранятся числом — сериализуемо любым бэкендом.
 */
interface IExportRecordEntry {
  readonly kind: string
  readonly addressIndex: number | null
  readonly risk: string
  readonly at: number
}

/**
 * Журнал экспортов поверх абстрактного хранилища.
 *
 * Все записи одного аккаунта лежат под одним ключом массивом. Причина:
 * записей на аккаунт единицы, а чтение всей истории требуется целиком
 * при каждой оценке риска. Отдельный ключ на запись означал бы перебор
 * всех ключей пространства имён на каждую проверку.
 */
export class ExportAuditLog implements IExportAuditLog {
  readonly #storage: IExportAuditStorage

  constructor(storage: IExportAuditStorage) {
    this.#storage = storage
  }

  async record(entry: IExportRecord): Promise<void> {
    const key = ExportAuditLog.#keyOf(entry.scope)
    const existing = await this.#read(key)

    /* Новая запись добавляется в начало: история читается от новых к старым,
       и сортировка при каждом чтении была бы лишней работой. */
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
