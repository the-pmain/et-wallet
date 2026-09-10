import { beforeEach, describe, expect, it } from 'vitest'

import { SecureStorage, STORAGE_NAMESPACE, toStorageKey } from '@/core'
import { FastEncryptionService, InMemoryStorageService, NullLogger } from '@/test/doubles'

import { SecureSessionStorage } from './SessionStorage'

const PASSWORD = 'Korova-7-Luna!'

/** Запись сессии в том виде, в каком её пишет библиотека. */
const SESSION_RECORD = {
  topic: 'a'.repeat(64),
  /* Именно из-за этого поля пространство зашифровано: им шифруется
     обмен с приложением через relay. */
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

describe('Хранилище подключений: переживание перезагрузки', () => {
  it('записанное читается обратно', async () => {
    /* Замена собственного хранилища библиотеки обязана сохранять её
       главное свойство: подключение переживает перезагрузку. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    expect(await storage.getItem('wc@2:client:session')).toEqual(SESSION_RECORD)
  })

  it('перечень ключей возвращается целиком', async () => {
    await storage.setItem('первый', 1)
    await storage.setItem('второй', 2)

    expect((await storage.getKeys()).sort()).toEqual(['второй', 'первый'])
  })

  it('пары ключ-значение возвращаются вместе', async () => {
    await storage.setItem('ключ', SESSION_RECORD)

    expect(await storage.getEntries()).toEqual([['ключ', SESSION_RECORD]])
  })

  it('удалённое исчезает', async () => {
    await storage.setItem('ключ', SESSION_RECORD)
    await storage.removeItem('ключ')

    expect(await storage.getItem('ключ')).toBeUndefined()
    expect(await storage.getKeys()).toEqual([])
  })

  it('отсутствующее читается как `undefined`, а не как `null`', async () => {
    /* Библиотека различает эти значения: `null` она считает записанным
       значением и разбирает как состояние сессии. */
    expect(await storage.getItem('никогда не записывалось')).toBeUndefined()
  })
})

describe('Хранилище подключений: секреты', () => {
  it('ключ сессии в базе открытым текстом не лежит', async () => {
    /* Получивший его читает переписку кошелька с приложением и может
       выдать себя за кошелёк. В собственной базе библиотеки он лежит
       открытым текстом. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    const raw = JSON.stringify(
      await underlying.get(STORAGE_NAMESPACE.DappSessions, toStorageKey('wc@2:client:session')),
    )

    expect(raw).not.toContain(SESSION_RECORD.symKey)
    expect(raw).not.toContain(SESSION_RECORD.topic)
  })

  it('удаление кошелька уносит подключения', async () => {
    /* Останься они — новый кошелёк на том же устройстве унаследовал бы
       чужие сессии. */
    await storage.setItem('wc@2:client:session', SESSION_RECORD)

    await secure.destroy()
    await secure.initialize(PASSWORD)

    expect(await storage.getKeys()).toEqual([])
  })
})

describe('Хранилище подключений: заблокированный кошелёк', () => {
  it('чтение при блокировке отдаёт пусто, а не бросает исключение', async () => {
    /* «Сейчас недоступно» честнее исключения: библиотека начнёт
       с чистого состояния, а не сломается посреди работы. */
    await storage.setItem('ключ', SESSION_RECORD)

    secure.lock()

    expect(await storage.getKeys()).toEqual([])
    expect(await storage.getItem('ключ')).toBeUndefined()
    expect(await storage.getEntries()).toEqual([])
  })

  it('запись при блокировке отказывает громко', async () => {
    /* Молча потерянная запись означает подключение, которое
       не переживёт перезагрузку, — ровно та неисправность, ради
       которой это хранилище написано. */
    secure.lock()

    await expect(storage.setItem('ключ', SESSION_RECORD)).rejects.toThrow()
  })

  it('после разблокировки записанное на месте', async () => {
    await storage.setItem('ключ', SESSION_RECORD)

    secure.lock()
    await secure.unlock(PASSWORD)

    expect(await storage.getItem('ключ')).toEqual(SESSION_RECORD)
  })
})

describe('Хранилище подключений: испорченная запись', () => {
  it('нечитаемая запись не лишает работоспособности весь раздел', async () => {
    /* Подключение будет установлено заново; отказ всего раздела
       из-за одной записи — цена несоразмерная. */
    await storage.setItem('целая', SESSION_RECORD)
    await underlying.set(STORAGE_NAMESPACE.DappSessions, toStorageKey('битая'), 'не шифротекст')

    const entries = await storage.getEntries()

    expect(await storage.getItem('битая')).toBeUndefined()
    expect(entries).toEqual([['целая', SESSION_RECORD]])
  })
})
