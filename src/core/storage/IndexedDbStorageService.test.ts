import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { MigrationFailedError } from '@/core/errors'

import { IndexedDbStorageService } from './IndexedDbStorageService'
import { toStorageKey } from './StorageKeys'
import { STORAGE_NAMESPACE, type IStorageMigration } from './types'

const KEY = toStorageKey('проба')
const OTHER_KEY = toStorageKey('вторая')

/**
 * Каждая проверка работает со своей базой.
 *
 * Общая база означала бы, что проверки видят записи друг друга и порядок
 * их выполнения влияет на результат.
 */
let databaseNumber = 0

function createStorage(migrations?: readonly IStorageMigration[]): IndexedDbStorageService {
  databaseNumber += 1

  return new IndexedDbStorageService({
    databaseName: `тест-${String(databaseNumber)}`,
    ...(migrations === undefined ? {} : { migrations }),
  })
}

let storage: IndexedDbStorageService

beforeEach(() => {
  storage = createStorage()
})

describe('IndexedDbStorageService: чтение и запись', () => {
  it('возвращает записанное значение', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, { значение: 42 })

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toEqual({ значение: 42 })
  })

  it('отсутствующая запись даёт null, а не исключение', async () => {
    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBeNull()
  })

  it('перезапись заменяет значение', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'первое')
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'второе')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('второе')
  })

  it('удаление убирает запись', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'значение')
    await storage.remove(STORAGE_NAMESPACE.Settings, KEY)

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBeNull()
  })

  it('has различает наличие и отсутствие', async () => {
    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(false)

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'значение')

    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(true)
  })

  it('has не считает записанный null отсутствием', async () => {
    /* `null` — это записанное значение, а не пустое место. Смешение
       этих случаев в кошельке означало бы «настройка не задана» там,
       где она задана явно. */
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, null)

    await expect(storage.has(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe(true)
  })

  it('перечисляет ключи пространства имён', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 1)
    await storage.set(STORAGE_NAMESPACE.Settings, OTHER_KEY, 2)

    await expect(storage.keys(STORAGE_NAMESPACE.Settings)).resolves.toEqual(
      expect.arrayContaining([KEY, OTHER_KEY]),
    )
  })

  it('очищает одно пространство имён, не трогая другие', async () => {
    /* Очистка кэша балансов не имеет права задеть хранилище ключей. */
    await storage.set(STORAGE_NAMESPACE.BalanceCache, KEY, 'кэш')
    await storage.set(STORAGE_NAMESPACE.Vault, KEY, 'секрет')

    await storage.clear(STORAGE_NAMESPACE.BalanceCache)

    await expect(storage.get(STORAGE_NAMESPACE.BalanceCache, KEY)).resolves.toBeNull()
    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('секрет')
  })

  it('одинаковые ключи в разных пространствах не пересекаются', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'настройка')
    await storage.set(STORAGE_NAMESPACE.Accounts, KEY, 'аккаунт')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('настройка')
    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('аккаунт')
  })
})

describe('IndexedDbStorageService: типы значений кошелька', () => {
  it('сохраняет bigint без потери точности', async () => {
    /* Суммы в кошельке — `bigint`. Через JSON их пришлось бы кодировать
       вручную, а приведение к `number` молча портит значение начиная
       с 2^53. Структурное клонирование IndexedDB сохраняет их как есть. */
    const огромное = 2n ** 200n + 12345n

    await storage.set(STORAGE_NAMESPACE.Transactions, KEY, { value: огромное })

    const прочитано = await storage.get<{ value: bigint }>(STORAGE_NAMESPACE.Transactions, KEY)

    expect(прочитано?.value).toBe(огромное)
    expect(typeof прочитано?.value).toBe('bigint')
  })

  it('сохраняет двоичные данные', async () => {
    /* Соль, вектор инициализации и шифротекст — байтовые массивы. */
    const байты = new Uint8Array([0, 1, 2, 255])

    await storage.set(STORAGE_NAMESPACE.Vault, KEY, байты)

    const прочитано = await storage.get<Uint8Array>(STORAGE_NAMESPACE.Vault, KEY)

    expect([...(прочитано ?? [])]).toEqual([0, 1, 2, 255])
  })

  it('возвращает копию, а не ссылку на записанный объект', async () => {
    /* Настоящее хранилище сериализует значение. Реализация,
       возвращающая ту же ссылку, скрыла бы ошибки общего состояния. */
    const записанное = { вложенное: { число: 1 } }

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, записанное)
    записанное.вложенное.число = 2

    const прочитано = await storage.get<typeof записанное>(STORAGE_NAMESPACE.Settings, KEY)

    expect(прочитано?.вложенное.число).toBe(1)
  })
})

describe('IndexedDbStorageService: сохранность между сессиями', () => {
  it('данные переживают пересоздание объекта', async () => {
    /* Главное свойство постоянного хранилища и единственная причина,
       по которой оно заменило хранилище в памяти. */
    const имя = `тест-переживание-${String(databaseNumber)}`
    const первое = new IndexedDbStorageService({ databaseName: имя })

    await первое.set(STORAGE_NAMESPACE.Vault, KEY, 'зашифрованная фраза')

    const второе = new IndexedDbStorageService({ databaseName: имя })

    await expect(второе.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('зашифрованная фраза')
  })

  it('сброс удаляет всё', async () => {
    await storage.set(STORAGE_NAMESPACE.Vault, KEY, 'секрет')
    await storage.destroy()

    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBeNull()
  })
})

describe('IndexedDbStorageService: транзакции', () => {
  it('записи транзакции видны после её завершения', async () => {
    await storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
      await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'первый')
      await transaction.set(STORAGE_NAMESPACE.Accounts, OTHER_KEY, 'второй')
    })

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('первый')
    await expect(storage.get(STORAGE_NAMESPACE.Accounts, OTHER_KEY)).resolves.toBe('второй')
  })

  it('исключение откатывает все записи транзакции', async () => {
    /* Добавление аккаунта меняет и хранилище ключей, и список аккаунтов.
       Запись только одного из двух оставляет кошелёк в противоречивом
       состоянии: аккаунт виден, а подписать им нечем. */
    await expect(
      storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'записано')

        throw new Error('сбой посреди записи')
      }),
    ).rejects.toThrow('сбой посреди записи')

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBeNull()
  })

  it('откат не затрагивает записи, сделанные до транзакции', async () => {
    await storage.set(STORAGE_NAMESPACE.Accounts, OTHER_KEY, 'прежнее')

    await expect(
      storage.transaction([STORAGE_NAMESPACE.Accounts], async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'новое')

        throw new Error('сбой')
      }),
    ).rejects.toThrow()

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, OTHER_KEY)).resolves.toBe('прежнее')
  })

  it('транзакция охватывает несколько пространств имён', async () => {
    await storage.transaction(
      [STORAGE_NAMESPACE.Accounts, STORAGE_NAMESPACE.Vault],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Accounts, KEY, 'аккаунт')
        await transaction.set(STORAGE_NAMESPACE.Vault, KEY, 'ключ')
      },
    )

    await expect(storage.get(STORAGE_NAMESPACE.Accounts, KEY)).resolves.toBe('аккаунт')
    await expect(storage.get(STORAGE_NAMESPACE.Vault, KEY)).resolves.toBe('ключ')
  })

  it('транзакция возвращает результат обработчика', async () => {
    const результат = await storage.transaction(
      [STORAGE_NAMESPACE.Settings],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 7)

        return 'готово'
      },
    )

    expect(результат).toBe('готово')
  })

  it('чтение внутри транзакции видит её собственные записи', async () => {
    const прочитано = await storage.transaction(
      [STORAGE_NAMESPACE.Settings],
      async (transaction) => {
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'внутри')

        return await transaction.get<string>(STORAGE_NAMESPACE.Settings, KEY)
      },
    )

    expect(прочитано).toBe('внутри')
  })
})

describe('IndexedDbStorageService: миграции', () => {
  it('выполняет шаг при первом открытии', async () => {
    const migrated = createStorage([
      {
        version: 1,
        description: 'заполняет настройку по умолчанию',
        migrate: async (transaction) => {
          await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'из миграции')
        },
      },
    ])

    await migrated.init()

    await expect(migrated.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('из миграции')
  })

  it('не выполняет шаг повторно', async () => {
    /* Прерывание работы браузера посреди обновления не должно приводить
       к повторному применению необратимого изменения. */
    const имя = `тест-миграция-${String(databaseNumber)}`
    let вызовов = 0

    const шаг: IStorageMigration = {
      version: 1,
      description: 'считает вызовы',
      migrate: async (transaction) => {
        вызовов += 1
        await transaction.set(STORAGE_NAMESPACE.Settings, KEY, вызовов)
      },
    }

    await new IndexedDbStorageService({ databaseName: имя, migrations: [шаг] }).init()
    await new IndexedDbStorageService({ databaseName: имя, migrations: [шаг] }).init()

    expect(вызовов).toBe(1)
  })

  it('сбой миграции не оставляет частичных изменений', async () => {
    const migrated = createStorage([
      {
        version: 1,
        description: 'падает посреди работы',
        migrate: async (transaction) => {
          await transaction.set(STORAGE_NAMESPACE.Settings, KEY, 'частично')

          throw new Error('данные не разобраны')
        },
      },
    ])

    await expect(migrated.init()).rejects.toThrow(MigrationFailedError)
  })

  it('шаги выполняются по возрастанию версии', async () => {
    const порядок: number[] = []

    const migrated = createStorage([
      {
        version: 2,
        description: 'второй',
        migrate: () => {
          порядок.push(2)

          return Promise.resolve()
        },
      },
      {
        version: 1,
        description: 'первый',
        migrate: () => {
          порядок.push(1)

          return Promise.resolve()
        },
      },
    ])

    await migrated.init()

    expect(порядок).toEqual([1, 2])
  })
})

describe('IndexedDbStorageService: открытие', () => {
  it('повторный init не открывает базу заново', async () => {
    await storage.init()

    await expect(storage.init()).resolves.toBeUndefined()
  })

  it('работает без явного init', async () => {
    /* Требование «вызвать init раньше всех» нарушается при добавлении
       нового потребителя, и нарушение выглядит как пустое хранилище —
       то есть как кошелёк, потерявший данные. */
    await expect(storage.set(STORAGE_NAMESPACE.Settings, KEY, 'без init')).resolves.toBeUndefined()
    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('без init')
  })
})

describe('IndexedDbStorageService: база прежней сборки', () => {
  it('недостающее хранилище создаётся, а не приводит к отказу', async () => {
    /*
      ЭТО СЛУЧИЛОСЬ ЖИВЬЁМ. Область была добавлена в перечень, а версия
      схемы выводится из числа миграций и осталась прежней: у базы,
      созданной предыдущей сборкой, `onupgradeneeded` не срабатывал,
      хранилище не появлялось, и кошелёк переставал открываться —
      у всех, кто пользовался им раньше, и только у них. На новой базе
      всё выглядело исправным, поэтому ни один прежний тест этого
      не показывал.
    */
    const имя = `старая-база-${String(Date.now())}`

    /* База предыдущей сборки: одно хранилище из многих. */
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(имя, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        request.result.close()
        resolve()
      }

      request.onerror = () => {
        reject(request.error ?? new Error('база не открылась'))
      }
    })

    const обновлённое = new IndexedDbStorageService({ databaseName: имя })

    await обновлённое.set(STORAGE_NAMESPACE.NetworksEncrypted, KEY, 'значение')

    await expect(обновлённое.get(STORAGE_NAMESPACE.NetworksEncrypted, KEY)).resolves.toBe(
      'значение',
    )
  })

  it('данные прежней сборки при этом не теряются', async () => {
    /* Пересоздать базу целиком было бы проще всего и означало бы
       потерю зашифрованной фразы: восстановить её без seed-фразы
       нельзя. */
    const имя = `старая-база-с-данными-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(имя, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        const database = request.result
        const store = database
          .transaction(STORAGE_NAMESPACE.Settings, 'readwrite')
          .objectStore(STORAGE_NAMESPACE.Settings)

        store.put('старое значение', KEY)

        store.transaction.oncomplete = () => {
          database.close()
          resolve()
        }
      }

      request.onerror = () => {
        reject(request.error ?? new Error('база не открылась'))
      }
    })

    const обновлённое = new IndexedDbStorageService({ databaseName: имя })

    await expect(обновлённое.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('старое значение')
  })
})

describe('IndexedDbStorageService: повторное открытие после починки', () => {
  it('второй запуск после починки схемы открывается', async () => {
    /*
      ЭТО ВТОРАЯ ЧАСТЬ ТОЙ ЖЕ ОШИБКИ, И ОДНА ПРОВЕРКА ЕЁ НЕ ЛОВИЛА.
      Починка недостающего хранилища повышает версию базы. Собственная
      версия схемы выводится из числа миграций и остаётся прежней,
      поэтому следующий запуск просил версию меньше существующей —
      а такой запрос браузер отвергает целиком. Первый запуск лечился,
      второй переставал открываться.
    */
    const имя = `починенная-база-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(имя, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORAGE_NAMESPACE.Settings)
      }

      request.onsuccess = () => {
        request.result.close()
        resolve()
      }

      request.onerror = () => {
        reject(request.error ?? new Error('база не открылась'))
      }
    })

    /* Первый запуск: недостающие хранилища создаются, версия растёт. */
    const первый = new IndexedDbStorageService({ databaseName: имя })

    await первый.set(STORAGE_NAMESPACE.NetworksEncrypted, KEY, 'значение')

    /* Второй запуск — новый экземпляр, как после перезагрузки страницы. */
    const второй = new IndexedDbStorageService({ databaseName: имя })

    await expect(второй.get(STORAGE_NAMESPACE.NetworksEncrypted, KEY)).resolves.toBe('значение')
  })

  it('база более новой версии открывается без понижения', async () => {
    /* Версия могла уйти вперёд и по другой причине — например, сборкой,
       которая новее установленной. Понизить её нельзя, а работать
       с ней можно. */
    const имя = `будущая-база-${String(Date.now())}`

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open(имя, 7)

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
        reject(request.error ?? new Error('база не открылась'))
      }
    })

    const storage = new IndexedDbStorageService({ databaseName: имя })

    await storage.set(STORAGE_NAMESPACE.Settings, KEY, 'работает')

    await expect(storage.get(STORAGE_NAMESPACE.Settings, KEY)).resolves.toBe('работает')
  })
})
