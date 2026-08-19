import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { MemorySettingsRepository } from '../settings/MemorySettingsRepository.ts'
import { MemoryUsersRepository } from '../users/MemoryUsersRepository.ts'

const CONFIG: IServerConfig = {
  mode: RUNTIME_MODE.Test,
  host: '127.0.0.1',
  port: 0,
  allowedOrigins: [],
  rateLimit: { max: 10_000, windowMs: 60_000 },
  maxBodyBytes: 64 * 1024,
  catalogCacheSeconds: 300,
  supabaseUrl: null,
  supabaseAnonKey: null,
}

const SYNC_ID = 'a'.repeat(64)

let app: FastifyInstance
let settings: MemorySettingsRepository
let users: MemoryUsersRepository

beforeEach(async () => {
  settings = new MemorySettingsRepository()
  users = new MemoryUsersRepository()
  app = await buildApp({ config: CONFIG, settings, users })
})

afterEach(async () => {
  await app.close()
})

describe('Каталог сетей', () => {
  it('отдаёт список сетей', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ networks: unknown[] }>().networks.length).toBeGreaterThan(0)
  })

  it('передаёт идентификатор сети строкой', async () => {
    /* `JSON.parse` молча теряет точность на больших числах, а сеть,
       отличающаяся от настоящей, — это подпись для другой цепи. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })
    const [first] = response.json<{ networks: { chainId: unknown }[] }>().networks

    expect(typeof first?.chainId).toBe('string')
  })

  it('разрешает кэширование каталога', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['cache-control']).toContain('max-age=300')
  })
})

describe('Рекомендуемые RPC', () => {
  it('отдаёт узлы известной сети', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/rpc' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ endpoints: unknown[] }>().endpoints.length).toBeGreaterThan(0)
  })

  it('называет оператора каждого узла', async () => {
    /* «Работает» и «работает через стороннего оператора, видящего все
       ваши адреса» — разные утверждения. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/rpc' })

    for (const endpoint of response.json<{ endpoints: { operator: string }[] }>().endpoints) {
      expect(endpoint.operator).not.toBe('')
    }
  })

  it('отвечает отказом для неизвестной сети', async () => {
    /* Пустой список для несуществующей сети читался бы как «узлов нет». */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/999999/rpc' })

    expect(response.statusCode).toBe(404)
  })

  it('отвергает нечисловой идентификатор сети', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/abc/rpc' })

    expect(response.statusCode).toBe(400)
  })

  it('отвергает идентификатор с ведущими нулями', async () => {
    /* Два написания одной сети дали бы два разных ключа кэша
       у посредников и расхождение ответов. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/001/rpc' })

    expect(response.statusCode).toBe(400)
  })
})

describe('Рекомендуемые токены', () => {
  it('отдаёт токены известной сети', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/tokens' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ tokens: unknown[] }>().tokens.length).toBeGreaterThan(0)
  })

  it('сообщает происхождение каждой записи', async () => {
    /* Признак «проверено» непроверяем, происхождение — проверяемо. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/tokens' })

    for (const token of response.json<{ tokens: { provenance: string[] }[] }>().tokens) {
      expect(token.provenance.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('отдаёт пустой список для сети без подтверждённых рекомендаций', async () => {
    /* Сеть известна, но её токены не сверялись двумя источниками.
       Это не то же самое, что несуществующая сеть. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/56/tokens' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ tokens: unknown[] }>().tokens).toEqual([])
  })

  it('отвечает отказом для неизвестной сети', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/999999/tokens' })

    expect(response.statusCode).toBe(404)
  })
})

describe('Системные уведомления', () => {
  it('отдаёт действующие уведомления', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/notifications' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ notifications: unknown[] }>().notifications.length).toBeGreaterThan(0)
  })

  it('не содержит ссылок ни в одном сообщении', async () => {
    /* Текст отсюда показывается внутри кошелька и неотличим для человека
       от сообщения самого приложения. */
    const response = await app.inject({ method: 'GET', url: '/v1/notifications' })

    for (const item of response.json<{ notifications: { title: string; body: string }[] }>()
      .notifications) {
      expect(`${item.title} ${item.body}`).not.toMatch(/https?:\/\//u)
    }
  })
})

describe('Проверка версии', () => {
  it('сообщает последнюю и минимально поддерживаемую версии', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ latest: string }>().latest).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  it('не сообщает адрес загрузки', async () => {
    /* «Скачайте обновление отсюда» — готовый способ увести пользователя
       на поддельный установщик. */
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })

    expect(response.body).not.toMatch(/https?:\/\//u)
  })

  it('оставляет признаки неизвестными, если версия клиента не сообщена', async () => {
    /* «Не знаем» нельзя подменять ни на «всё в порядке», ни на «пора
       обновляться». */
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })
    const body = response.json<{ isSupported: unknown; isOutdated: unknown }>()

    expect(body.isSupported).toBeNull()
    expect(body.isOutdated).toBeNull()
  })

  it('признаёт устаревшей версию ниже последней', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version?version=0.0.1' })
    const body = response.json<{ isOutdated: boolean; isSupported: boolean }>()

    expect(body.isOutdated).toBe(true)
    expect(body.isSupported).toBe(false)
  })

  it('отвергает версию с предвыпускной меткой', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version?version=1.0.0-beta' })

    expect(response.statusCode).toBe(400)
  })
})

describe('Синхронизация настроек', () => {
  it('сообщает об отсутствии записи', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(response.statusCode).toBe(404)
  })

  it('сохраняет и возвращает шифротекст без изменений', async () => {
    const written = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0', revision: 0 },
    })

    expect(written.statusCode).toBe(200)

    const read = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(read.json<{ ciphertext: string }>().ciphertext).toBe('c2VjcmV0')
  })

  it('запрещает кэширование настроек', async () => {
    /* Это данные конкретного пользователя, пусть и зашифрованные. */
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0', revision: 0 },
    })

    const read = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(read.headers['cache-control']).toBe('no-store')
  })

  it('отвергает запись с устаревшим номером версии', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0 },
    })

    const conflict = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'Yg==', revision: 0 },
    })

    expect(conflict.statusCode).toBe(409)
  })

  it('отвергает короткий идентификатор синхронизации', async () => {
    /* Идентификатор — ключ-предъявитель: он обязан быть случайным
       и длинным, а не удобным. */
    const response = await app.inject({ method: 'GET', url: '/v1/settings/abc' })

    expect(response.statusCode).toBe(400)
  })

  it('отвергает неизвестное поле в теле запроса', async () => {
    /* Клиент с ошибкой не должен иметь возможности незаметно передать
       сервису то, чего тот принимать не должен. */
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0, mnemonic: 'нечто' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('удаляет запись', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0 },
    })

    const removed = await app.inject({ method: 'DELETE', url: `/v1/settings/${SYNC_ID}` })

    expect(removed.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })).statusCode).toBe(
      404,
    )
  })

  it('удаление отсутствующей записи не считается ошибкой', async () => {
    /* Иначе ответ сообщал бы, существует ли запись, тому, кто подбирает
       идентификатор. */
    const response = await app.inject({ method: 'DELETE', url: `/v1/settings/${SYNC_ID}` })

    expect(response.statusCode).toBe(204)
  })
})

describe('Пользователи', () => {
  it('записывает имя, баланс и the_p', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'James', balance: '0', the_p: 'demo' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ username: string; balance: string }>().username).toBe('James')
    expect(response.json<{ the_p?: unknown; password?: unknown }>()).not.toHaveProperty('the_p')
    expect(response.json<{ password?: unknown }>()).not.toHaveProperty('password')
    expect(users.records).toHaveLength(1)
    expect(users.records[0]?.theP).toBe('demo')
  })

  it('подставляет нулевой баланс, если его не передали', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'Maria' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ balance: string }>().balance).toBe('0')
  })

  it('запрещает кэширование ответа', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'James' },
    })

    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('Охранник входящих данных', () => {
  it('отвергает тело, содержащее приватный ключ', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: `0x${'a1'.repeat(32)}`, revision: 0 },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('secret_material_rejected')
  })

  it('отвергает тело, содержащее мнемоническую фразу', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: {
        ciphertext: 'test test test test test test test test test test test junk',
        revision: 0,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('secret_material_rejected')
  })

  it('не сохраняет отвергнутое тело', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: `0x${'a1'.repeat(32)}`, revision: 0 },
    })

    expect(await settings.get(SYNC_ID)).toBeNull()
  })

  it('пропускает обычный шифротекст', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0LXNldHRpbmdz', revision: 0 },
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('Общее поведение сервиса', () => {
  it('отвечает на проверку живости', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' })

    expect(response.statusCode).toBe(200)
  })

  it('отвечает отказом на несуществующий маршрут', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/нет-такого' })

    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('не принимает запись через POST', async () => {
    /* Список разрешённых методов ограничен: маршрута, принимающего
       произвольные данные, у сервиса нет. */
    const response = await app.inject({
      method: 'POST',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0 },
    })

    expect(response.statusCode).toBe(404)
  })

  it('запрещает встраивание в рамку откуда бы то ни было', async () => {
    /* Умолчание `SAMEORIGIN` разрешает встраивание с того же источника.
       Сервису нечего показывать в рамке ни при каких условиях. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['x-frame-options']).toBe('DENY')
  })

  it('не разрешает исполнение сценариев политикой безопасности', async () => {
    /* Директивы helmet по умолчанию рассчитаны на сайт и разрешают
       `script-src 'self'` вместе с `'unsafe-inline'` для стилей.
       Сервису, отдающему JSON, не нужно ничего из этого. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })
    const policy = String(response.headers['content-security-policy'])

    expect(policy).toContain("default-src 'none'")
    expect(policy).not.toContain('script-src')
    expect(policy).not.toContain('unsafe-inline')
  })

  it('запрещает угадывание типа содержимого', async () => {
    /* Ответ JSON, истолкованный браузером как HTML, — известный путь
       к исполнению чужого кода. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })
})
