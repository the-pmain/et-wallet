import type { IStorageService } from './StorageService'
import {
  STORAGE_DURABILITY,
  type IStorageEstimate,
  type IStorageTransaction,
  type StorageDurability,
  type StorageKey,
  type StorageNamespace,
} from './types'

type NamespaceData = Map<StorageKey, unknown>

/**
 * In-memory storage.
 *
 * TWO PURPOSES, both legitimate:
 *
 * 1. **Tests.** Replaces IndexedDB without needing a browser environment.
 *
 * 2. **Session mode.** A wallet that exists until the page reloads.
 *    Used while persistent storage is not implemented, and remains
 *    useful as a "leave no traces on this device" mode.
 *
 * Two properties make it a fit replacement for real storage:
 *
 * - **Copying values via `structuredClone`.** Real storage serializes
 *   data, so the caller never gets a reference to the same object it
 *   wrote. An implementation that returned the same reference would
 *   hide accidental shared-state bugs.
 *
 * - **A real transaction rollback.** A snapshot is taken before the
 *   handler runs and is restored on exception.
 *
 * WHAT IT DOES NOT GIVE: durability across sessions. Data vanishes
 * with the tab, including the encrypted key vault.
 */
export class MemoryStorageService implements IStorageService {
  readonly #data = new Map<StorageNamespace, NamespaceData>()

  /** Write-operation counter. Lets tests check there are no extra calls. */
  writeCount = 0

  init(): Promise<void> {
    return Promise.resolve()
  }

  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
    const value = this.#namespace(namespace).get(key)

    return Promise.resolve(value === undefined ? null : (structuredClone(value) as TValue))
  }

  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void> {
    this.writeCount += 1
    this.#namespace(namespace).set(key, structuredClone(value))

    return Promise.resolve()
  }

  remove(namespace: StorageNamespace, key: StorageKey): Promise<void> {
    this.#namespace(namespace).delete(key)

    return Promise.resolve()
  }

  has(namespace: StorageNamespace, key: StorageKey): Promise<boolean> {
    return Promise.resolve(this.#namespace(namespace).has(key))
  }

  keys(namespace: StorageNamespace): Promise<readonly StorageKey[]> {
    return Promise.resolve([...this.#namespace(namespace).keys()])
  }

  clear(namespace: StorageNamespace): Promise<void> {
    this.#namespace(namespace).clear()

    return Promise.resolve()
  }

  async transaction<TResult>(
    namespaces: readonly StorageNamespace[],
    handler: (transaction: IStorageTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = new Map<StorageNamespace, NamespaceData>()

    for (const namespace of namespaces) {
      snapshot.set(namespace, new Map(this.#namespace(namespace)))
    }

    try {
      return await handler(this)
    } catch (error) {
      for (const [namespace, data] of snapshot) {
        this.#data.set(namespace, data)
      }

      throw error
    }
  }

  estimate(): Promise<IStorageEstimate | null> {
    return Promise.resolve(null)
  }

  /** Data vanishes with the tab — and that must be said outright. */
  durability(): Promise<StorageDurability> {
    return Promise.resolve(STORAGE_DURABILITY.Session)
  }

  destroy(): Promise<void> {
    this.#data.clear()

    return Promise.resolve()
  }

  #namespace(namespace: StorageNamespace): NamespaceData {
    let data = this.#data.get(namespace)

    if (data === undefined) {
      data = new Map<StorageKey, unknown>()
      this.#data.set(namespace, data)
    }

    return data
  }
}
