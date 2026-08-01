import { beforeEach, describe, expect, it } from 'vitest'

import { ConflictError } from '../lib/errors.ts'

import { MemorySettingsRepository } from './MemorySettingsRepository.ts'

const SYNC_ID = 'a'.repeat(64)
const OTHER_ID = 'b'.repeat(64)

/** Управляемое время: срок жизни записи обязан проверяться, а не наблюдаться. */
let now: Date
let repository: MemorySettingsRepository

const TTL_MS = 1000

beforeEach(() => {
  now = new Date('2026-07-31T00:00:00.000Z')
  repository = new MemorySettingsRepository({ ttlMs: TTL_MS, now: () => now })
})

describe('Хранилище настроек: чтение и запись', () => {
  it('возвращает null для неизвестного идентификатора', async () => {
    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('сохраняет шифротекст без изменений', async () => {
    /* Сервис не разбирает содержимое и не имеет кода, способного
       его расшифровать: что пришло, то и хранится. */
    await repository.put(SYNC_ID, 'c2VjcmV0', 0)

    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('c2VjcmV0')
  })

  it('начинает нумерацию версий с единицы', async () => {
    const record = await repository.put(SYNC_ID, 'YQ==', 0)

    expect(record.revision).toBe(1)
  })

  it('увеличивает номер версии при каждой записи', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    const second = await repository.put(SYNC_ID, 'Yg==', 1)

    expect(second.revision).toBe(2)
  })

  it('разделяет записи разных идентификаторов', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    await repository.put(OTHER_ID, 'Yg==', 0)

    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('YQ==')
    expect((await repository.get(OTHER_ID))?.ciphertext).toBe('Yg==')
  })
})

describe('Хранилище настроек: одновременная запись', () => {
  it('отвергает запись с устаревшим номером версии', async () => {
    /* Два устройства, писавшие одновременно, иначе затёрли бы
       изменения друг друга молча. */
    await repository.put(SYNC_ID, 'YQ==', 0)

    await expect(repository.put(SYNC_ID, 'Yg==', 0)).rejects.toBeInstanceOf(ConflictError)
  })

  it('отвергает первую запись с номером версии больше нуля', async () => {
    await expect(repository.put(SYNC_ID, 'YQ==', 5)).rejects.toBeInstanceOf(ConflictError)
  })

  it('не изменяет хранимое при отказе', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)

    await expect(repository.put(SYNC_ID, 'Yg==', 0)).rejects.toBeInstanceOf(ConflictError)
    expect((await repository.get(SYNC_ID))?.ciphertext).toBe('YQ==')
  })
})

describe('Хранилище настроек: срок жизни', () => {
  it('забывает запись по истечении срока', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('после истечения срока запись начинается заново', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    const record = await repository.put(SYNC_ID, 'Yg==', 0)

    expect(record.revision).toBe(1)
  })
})

describe('Хранилище настроек: удаление', () => {
  it('удаляет запись', async () => {
    await repository.put(SYNC_ID, 'YQ==', 0)
    await repository.remove(SYNC_ID)

    expect(await repository.get(SYNC_ID)).toBeNull()
  })

  it('удаление отсутствующей записи не считается ошибкой', async () => {
    /* Иначе ответ сообщал бы, существует ли запись с таким
       идентификатором, тому, кто его подбирает. */
    await expect(repository.remove(SYNC_ID)).resolves.toBeUndefined()
  })
})

describe('Хранилище настроек: предел размера', () => {
  it('отказывает при достижении предела', async () => {
    const small = new MemorySettingsRepository({ maxRecords: 1, ttlMs: TTL_MS, now: () => now })

    await small.put(SYNC_ID, 'YQ==', 0)

    await expect(small.put(OTHER_ID, 'Yg==', 0)).rejects.toThrow(/заполнено/u)
  })

  it('освобождает место за счёт записей с истёкшим сроком', async () => {
    const small = new MemorySettingsRepository({ maxRecords: 1, ttlMs: TTL_MS, now: () => now })

    await small.put(SYNC_ID, 'YQ==', 0)
    now = new Date(now.getTime() + TTL_MS + 1)

    await expect(small.put(OTHER_ID, 'Yg==', 0)).resolves.toMatchObject({ revision: 1 })
  })
})
