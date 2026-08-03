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

/** Имя базы по умолчанию. */
const DEFAULT_DATABASE_NAME = 'etwallet'

/** Настройки хранилища. */
export interface IIndexedDbStorageOptions {
  /**
   * Имя базы данных.
   *
   * Задаётся ради тестов: каждая проверка работает со своей базой,
   * иначе они видели бы данные друг друга.
   */
  readonly databaseName?: string

  /**
   * Шаги миграции схемы, по возрастанию версии.
   *
   * ТРЕБОВАНИЕ К РЕАЛИЗАЦИИ ШАГА, НАРУШЕНИЕ КОТОРОГО НЕЗАМЕТНО.
   * Внутри миграции можно ожидать только операции этого же хранилища.
   * Любое другое ожидание — обращение к сети, таймер, чтение файла —
   * отпускает транзакцию IndexedDB: браузер завершает её, как только
   * очередь микрозадач опустела без незакрытых запросов. Дальнейшие
   * записи такой миграции молча потеряются.
   */
  readonly migrations?: readonly IStorageMigration[]
}

/**
 * Постоянное хранилище поверх IndexedDB.
 *
 * ПОЧЕМУ IndexedDB, А НЕ localStorage. Запрет на `localStorage` действует
 * в проекте с первого этапа и вынесен в правило ESLint: он синхронен,
 * хранит только строки, доступен любому скрипту страницы и отсутствует
 * в service worker manifest v3. Здесь важно ещё одно: IndexedDB
 * сериализует значения структурным клонированием, а оно **сохраняет
 * `bigint` и `Uint8Array` без потерь**. Через JSON суммы кошелька
 * пришлось бы кодировать вручную, и ошибка в кодеке означала бы молча
 * испорченный баланс.
 *
 * ЧТО ЭТОТ СЛОЙ НЕ ДЕЛАЕТ: не шифрует. Шифрование выполняет
 * `SecureStorage` до записи. Иначе хранилище начало бы само решать,
 * что считать секретом.
 *
 * ОТКРЫТИЕ ЛЕНИВОЕ И ОДНОКРАТНОЕ. База открывается при первом
 * обращении, а не отдельным вызовом в точке входа. Требование «вызвать
 * `init` раньше всех» неизбежно нарушается при добавлении нового
 * потребителя, и нарушение проявляется как пустое хранилище —
 * то есть как потерянный кошелёк. `init` остаётся доступным
 * и идемпотентным для тех, кому нужно открыть базу заранее.
 *
 * ХРАНИЛИЩЕ БРАУЗЕРА МОЖЕТ БЫТЬ ОЧИЩЕНО БЕЗ СПРОСА. При нехватке места
 * браузер вправе вытеснить данные сайта, а для кошелька это значит
 * потерю зашифрованной seed-фразы. Поэтому при открытии запрашивается
 * постоянное хранение; результат доступен через {@link durability}
 * и обязан быть показан пользователю, если разрешение не получено.
 */
export class IndexedDbStorageService implements IStorageService {
  readonly #databaseName: string
  readonly #migrations: readonly IStorageMigration[]
  #schemaVersion: number

  #opening: Promise<IDBDatabase> | null = null

  /**
   * Браузер обещал не вытеснять данные.
   *
   * `false` до открытия базы и в средах, где обещание недоступно.
   */
  #isPersistent = false

  constructor(options: IIndexedDbStorageOptions = {}) {
    this.#databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
    this.#migrations = [...(options.migrations ?? [])].sort(
      (left, right) => left.version - right.version,
    )

    /* Версия схемы на единицу больше последней миграции: первая версия
       занята созданием хранилищ, которое миграцией не является. */
    this.#schemaVersion =
      this.#migrations.reduce((maximum, migration) => Math.max(maximum, migration.version), 0) + 1
  }

  async init(): Promise<void> {
    await this.#open()
  }

  async get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
    try {
      /* IndexedDB отдаёт значение как `any`: содержимое записи ему
         неизвестно. Сужение до `unknown` возвращает проверку типов
         вызывающему коду, вместо того чтобы молча пропустить что угодно. */
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
      /* Читается ключ, а не значение: запись кошелька может весить
         килобайты, и проверять её наличие расшифровкой незачем. */
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
   * Выполняет операции атомарно.
   *
   * ОТКАТ ВЫПОЛНЯЕТ САМА IndexedDB. Исключение внутри обработчика
   * приводит к `abort`, и записи, сделанные до него, не сохраняются.
   * Своего снимка не делается: он был бы копией данных в памяти
   * и разошёлся бы с базой при параллельной записи.
   *
   * Ограничение то же, что у миграций: внутри обработчика можно ожидать
   * только операции этого хранилища.
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
      /* Обещание завершения гасится до прерывания: `abort` заставит его
         отклониться, а ждать его здесь никто не будет — наружу уходит
         исходная причина. Незамеченный отказ обещания в браузере даёт
         событие `unhandledrejection`, а в Node способен уронить процесс. */
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

    /* «Неизвестно» не подменяется нулём: ноль занятого места
       и отсутствие сведений — разные утверждения, и второе, показанное
       как первое, успокаивает без оснований. */
    return usage === undefined || quota === undefined ? null : { usage, quota }
  }

  /**
   * Насколько надёжно хранилище удерживает данные.
   *
   * База открывается, если ещё не открыта: разрешение на постоянное
   * хранение запрашивается там же, и отвечать до этого значило бы
   * пугать владельца состоянием, которого уже нет.
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
      /* Удаление ждёт закрытия всех соединений. Другая вкладка, держащая
         базу открытой, заблокирует его — и это не ошибка, а причина,
         которую нужно назвать. */
      request.onblocked = () => {
        reject(
          new StorageUnavailableError(
            'the database is open in another tab; close it and repeat the reset',
          ),
        )
      }
    })
  }

  /** Открывает базу, создавая хранилища и выполняя миграции. */
  async #open(): Promise<IDBDatabase> {
    this.#opening ??= this.#openOnce()

    try {
      return await this.#opening
    } catch (error) {
      /* Неудачное открытие не запоминается: следующая попытка должна
         открыть базу заново, а не получить сохранённый отказ. */
      this.#opening = null

      throw error
    }
  }

  async #openOnce(): Promise<IDBDatabase> {
    if (globalThis.indexedDB === undefined) {
      throw new StorageUnavailableError('IndexedDB is unavailable in this environment')
    }

    await this.#requestPersistence()

    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.#databaseName, this.#schemaVersion)

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

        /* Другая вкладка обновила схему: держать открытым соединение
           со старой версией нельзя — оно заблокирует обновление. */
        database.onversionchange = () => {
          database.close()
          this.#opening = null
        }

        /*
          БАЗА, СОЗДАННАЯ ПРЕЖНЕЙ СБОРКОЙ, МОЖЕТ НЕ ИМЕТЬ НОВЫХ ХРАНИЛИЩ.

          Список хранилищ выводится из перечня областей, а версия схемы —
          из числа миграций. Добавление области без миграции оставляло
          версию прежней, и `onupgradeneeded` у существующей базы
          не срабатывал: хранилище не создавалось, а чтение из него
          отказывало. Кошелёк переставал открываться у всех, кто
          пользовался им до обновления, — и только у них, поэтому
          на новой базе всё выглядело исправным.

          Здесь недостача обнаруживается и исправляется сама: база
          переоткрывается со следующей версией, и хранилища создаются
          обычным путём. Полагаться на то, что о версии не забудут,
          нельзя — забывают именно так.
        */
        const missing = [...Object.values(STORAGE_NAMESPACE)].filter(
          (namespace) => !database.objectStoreNames.contains(namespace),
        )

        if (missing.length > 0) {
          database.close()
          this.#schemaVersion = database.version + 1

          this.#openOnce().then(resolve, reject)

          return
        }

        resolve(database)
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

  /** Выполняет непримененные шаги миграции в транзакции обновления. */
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
   * Просит браузер не вытеснять данные.
   *
   * Отказ не является ошибкой: в приватном окне и без взаимодействия
   * пользователя разрешение не выдаётся, а кошелёк обязан работать
   * и там. Результат запоминается, чтобы интерфейс мог предупредить.
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

  /** Читает из одного хранилища. */
  async #read<TResult>(
    namespace: StorageNamespace,
    operation: (store: IDBObjectStore) => IDBRequest<TResult>,
  ): Promise<TResult> {
    const database = await this.#open()
    const transaction = database.transaction(namespace, 'readonly')

    return await promisify(operation(transaction.objectStore(namespace)))
  }

  /** Пишет в одно хранилище и дожидается завершения транзакции. */
  async #write(
    namespace: StorageNamespace,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    const database = await this.#open()
    const transaction = database.transaction(namespace, 'readwrite')
    const completion = trackCompletion(transaction)

    await promisify(operation(transaction.objectStore(namespace)))

    /* Ожидание завершения транзакции, а не только запроса: успешный
       запрос ещё не означает записанных данных — транзакция может
       быть прервана нехваткой квоты. */
    await completion
  }
}

/**
 * Превращает ключ IndexedDB в ключ хранилища.
 *
 * Хранилище использует только строковые ключи — их задаёт
 * `toStorageKey`. Числа, даты и составные ключи, допустимые
 * в IndexedDB, здесь появиться не могут, и превращать их в строку
 * вслепую значило бы получить `[object Object]` вместо имени записи.
 */
function toStorageKeyFromIdb(key: IDBValidKey): StorageKey {
  if (typeof key !== 'string') {
    throw new StorageUnavailableError(`a non-string record key: ${typeof key}`)
  }

  return key as StorageKey
}

/** Превращает запрос IndexedDB в обещание. */
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
 * Обещание завершения транзакции.
 *
 * Создаётся ДО первой операции: обработчики, назначенные после
 * завершения транзакции, уже не вызовутся, и ожидание повисло бы.
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
 * Прерывает транзакцию, не заслоняя исходную причину.
 *
 * `abort` бросает, если транзакция уже завершена. Эта ошибка не имеет
 * отношения к тому, из-за чего откатывались, и подменять ею настоящую
 * причину нельзя.
 */
function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch {
    /* Транзакция уже закрыта — откатывать нечего. */
  }
}

/** Оборачивает транзакцию IndexedDB в контракт хранилища. */
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
