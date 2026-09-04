import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { MemorySendingsRepository } from '../sendings/MemorySendingsRepository.ts'
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
  supabasePublishableKey: null,
  supabaseServiceRoleKey: null,
  staticRoot: null,
  cloudflareAccountId: null,
  cloudflareApiToken: null,
  cloudflareAuthEmail: null,
  mailFrom: null,
  r2AccessKeyId: null,
  r2SecretAccessKey: null,
  r2Endpoint: null,
  r2Bucket: null,
  emailWebhookSecret: null,
}

const SEED_PHRASE =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

const SERVICE_ROLE = 'sb_secret_test_service_role_key'
const RECIPIENT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

describe('public.sendings authorization', () => {
  let app: FastifyInstance
  let users: MemoryUsersRepository
  let sendings: MemorySendingsRepository

  beforeEach(async () => {
    users = new MemoryUsersRepository()
    sendings = new MemorySendingsRepository()
    app = await buildApp({
      config: { ...CONFIG, supabaseServiceRoleKey: SERVICE_ROLE },
      users,
      sendings,
    })
  })

  afterEach(async () => {
    await app.close()
  })

  async function seedUser(email: string, theP: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email, the_p: theP, seed_phrase: SEED_PHRASE },
    })

    expect(response.statusCode).toBe(201)

    return response.json<{ id: string }>().id
  }

  async function seedSending(userId: string, email: string, theP: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email,
        the_p: theP,
        recipient_address: RECIPIENT,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)

    return response.json<{ id: string }>().id
  }

  it('без учётки не читает чужие переводы', async () => {
    const id = await seedUser('james@example.com', 'demo')

    const missing = await app.inject({ method: 'GET', url: `/v1/users/${id}/sendings` })
    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/users/${id}/sendings`,
      query: { email: 'james@example.com', the_p: 'wrong' },
    })

    expect(missing.statusCode).toBe(400)
    expect(wrong.statusCode).toBe(401)
  })

  it('аутентифицированный пользователь не читает чужие переводы', async () => {
    const jamesId = await seedUser('james@example.com', 'james-p')
    const mariaId = await seedUser('maria@example.com', 'maria-p')
    await seedSending(mariaId, 'maria@example.com', 'maria-p')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${mariaId}/sendings`,
      query: { email: 'james@example.com', the_p: 'james-p' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.body).not.toContain(mariaId)
    expect(jamesId).not.toBe(mariaId)
  })

  it('не даёт писать перевод на чужой user_id', async () => {
    const jamesId = await seedUser('james@example.com', 'james-p')
    const mariaId = await seedUser('maria@example.com', 'maria-p')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: mariaId,
        email: 'james@example.com',
        the_p: 'james-p',
        recipient_address: RECIPIENT,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(sendings.records).toHaveLength(0)
    expect(jamesId).not.toBe(mariaId)
  })

  it('отвергает role и неизвестные поля', async () => {
    const id = await seedUser('james@example.com', 'demo')
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: id,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: RECIPIENT,
        amount: '0.01',
        symbol: 'ETH',
        role: 'admin',
        status: 'success',
      },
    })

    expect(created.statusCode).toBe(400)
    expect(sendings.records).toHaveLength(0)
  })

  it('не даёт пользователю менять статус или чужой перевод', async () => {
    const id = await seedUser('james@example.com', 'demo')
    const sendingId = await seedSending(id, 'james@example.com', 'demo')
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/users/sendings/${sendingId}`,
      payload: { status: 'success', recipientAddress: RECIPIENT, amount: '9', symbol: 'ETH' },
    })

    expect(patch.statusCode).toBe(404)
    expect(sendings.records[0]?.status).toBe('pending')
    expect(sendings.records[0]?.amount).toBe('0.01')
  })

  it('без PIN не пускает в кабинет, с PIN — только заявленные admin-операции', async () => {
    const id = await seedUser('james@example.com', 'demo')
    const sendingId = await seedSending(id, 'james@example.com', 'demo')

    const denied = await app.inject({ method: 'GET', url: '/v1/admin/sendings' })
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/admin/sendings',
      headers: { 'x-admin-pin': '9100' },
    })
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sendingId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'success',
        recipientAddress: RECIPIENT,
        amount: '0.02',
        symbol: 'ETH',
        user_id: '99',
        role: 'admin',
      },
    })
    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sendingId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'failure',
        failureMessage: 'rejected',
        recipientAddress: RECIPIENT,
        amount: '0.02',
        symbol: 'ETH',
      },
    })

    expect(denied.statusCode).toBe(401)
    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ sendings: { userId: string }[] }>().sendings[0]?.userId).toBe(id)
    expect(rejected.statusCode).toBe(400)
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      id: sendingId,
      userId: id,
      status: 'failure',
      amount: '0.02',
      symbol: 'ETH',
    })
    expect(updated.json()).not.toHaveProperty('the_p')
    expect(updated.body).not.toContain(SERVICE_ROLE)
    expect(listed.body).not.toContain(SERVICE_ROLE)
  })

  it('сохраняет форму ответа перевода', async () => {
    const id = await seedUser('james@example.com', 'demo')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: id,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: RECIPIENT,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(Object.keys(response.json<Record<string, unknown>>()).sort()).toEqual([
      'amount',
      'createdAt',
      'failureMessage',
      'id',
      'recipientAddress',
      'status',
      'symbol',
      'userId',
    ])
    expect(response.json()).toMatchObject({
      userId: id,
      status: 'pending',
      amount: '0.01',
      symbol: 'ETH',
    })
    expect(response.body).not.toContain(SERVICE_ROLE)
    expect(response.body).not.toContain('demo')
  })
})
