import type { IStorageService } from './StorageService'
import type { IStorageEstimate, IStorageTransaction, StorageKey, StorageNamespace } from './types'

type NamespaceData = Map<StorageKey, unknown>

/**
 * Хранилище в оперативной памяти.
 *
 * ДВА НАЗНАЧЕНИЯ, оба законные:
 *
 * 1. **Тесты.** Заменяет IndexedDB, не требуя браузерного окружения.
 *
 * 2. **Сессионный режим.** Кошелёк, существующий до перезагрузки страницы.
 *    Применяется, пока постоянное хранилище не реализовано, и остаётся
 *    полезным как режим «не оставлять следов на этом устройстве».
 *
 * Два свойства делают его пригодной заменой настоящему хранилищу:
 *
 * - **Копирование значений через `structuredClone`.** Реальное хранилище
 *   сериализует данные, поэтому вызывающий код никогда не получает ссылку
 *   на тот же объект, который записал. Реализация, возвращающая ту же
 *   ссылку, скрыла бы ошибки непреднамеренного разделения состояния.
 *
 * - **Настоящий откат транзакции.** Снимок делается до вызова обработчика
 *   и восстанавливается при исключении.
 *
 * ЧЕГО ОНО НЕ ДАЁТ: сохранности между сессиями. Данные исчезают вместе
 * со вкладкой, включая зашифрованное хранилище ключей.
 */
export class MemoryStorageService implements IStorageService {
  readonly #data = new Map<StorageNamespace, NamespaceData>()

  /** Счётчик операций записи. Позволяет проверять отсутствие лишних обращений. */
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
