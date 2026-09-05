import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { MemorySendingsRepository } from '../sendings/MemorySendingsRepository.ts'
import { MemoryUsersRepository } from '../users/MemoryUsersRepository.ts'

process.env['ADMIN_PIN'] = '4200'
process.env['SUPER_ADMIN_PIN'] = '9100'

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
    adminPin: null,
    superAdminPin: null,
}

const SEED_PHRASE =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

const SERVICE_ROLE = 'sb_secret_test_service_role_key'

describe('public.users authorization', () => {
  let app: FastifyInstance
  let users: MemoryUsersRepository

  beforeEach(async () => {
    users = new MemoryUsersRepository()
    app = await buildApp({
      config: { ...CONFIG, supabaseServiceRoleKey: SERVICE_ROLE },
      users,
      sendings: new MemorySendingsRepository(),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  async function seed(email: string, theP: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email, the_p: theP, seed_phrase: SEED_PHRASE },
    })

    expect(response.statusCode).toBe(201)

    return response.json<{ id: string }>().id
  }

  it('without credentials does not read another row', async () => {
    const id = await seed('james@example.com', 'demo')

    const missing = await app.inject({ method: 'GET', url: `/v1/users/${id}` })
    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/users/${id}`,
      query: { email: 'james@example.com', the_p: 'wrong' },
    })

    expect(missing.statusCode).toBe(400)
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json<{ error: { code: string } }>().error.code).toBe('unauthorized')
  })

  it('an authenticated user does not read another row', async () => {
    const jamesId = await seed('james@example.com', 'james-p')
    const mariaId = await seed('maria@example.com', 'maria-p')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${mariaId}`,
      query: { email: 'james@example.com', the_p: 'james-p' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).not.toMatchObject({ id: mariaId })
    expect(response.body).not.toContain('maria@example.com')
    expect(jamesId).not.toBe(mariaId)
  })

  it('an authenticated user does not change another row', async () => {
    await seed('james@example.com', 'james-p')
    await seed('maria@example.com', 'maria-p')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/wallets',
      payload: {
        email: 'james@example.com',
        the_p: 'maria-p',
        codename: 'address-receiving-funds',
        key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        value: '1',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(users.records[0]?.wallets).toEqual({})
    expect(users.records[1]?.wallets).toEqual({})
  })

  it('rejects role, rights and unknown fields on self-service', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        role: 'admin',
        permissions: ['*'],
        organization_id: 'org-1',
        approved: true,
      },
    })
    const authExtra = await app.inject({
      method: 'POST',
      url: '/v1/users/auth',
      payload: { email: 'james@example.com', the_p: 'demo', role: 'admin' },
    })

    expect(created.statusCode).toBe(400)
    expect(authExtra.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('does not let a user change balance, email or the_p on their route', async () => {
    const id = await seed('james@example.com', 'demo')
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${id}`,
      payload: { email: 'other@example.com', balance: '999', the_p: 'hacked', role: 'admin' },
    })

    expect(patch.statusCode).toBe(404)
    expect(users.records[0]?.email).toBe('james@example.com')
    expect(users.records[0]?.balance).toBe('0')
    expect(users.records[0]?.theP).toBe('demo')
  })

  it('without a PIN blocks the cabinet; with a PIN — only declared admin operations', async () => {
    const id = await seed('james@example.com', 'demo')

    const denied = await app.inject({ method: 'GET', url: '/v1/admin/users' })
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { 'x-admin-pin': '9100' },
    })
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '9100' },
      payload: { balance: '12.5', role: 'superadmin' },
    })
    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '9100' },
      payload: { balance: '12.5' },
    })

    expect(denied.statusCode).toBe(401)
    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ users: { email: string }[] }>().users[0]?.email).toBe(
      'james@example.com',
    )
    expect(patched.statusCode).toBe(400)
    expect(updated.statusCode).toBe(200)
    expect(updated.json<{ balance: string }>().balance).toBe('12.5')
    expect(updated.json()).toMatchObject({
      id,
      email: 'james@example.com',
      balance: '12.5',
    })
    expect(updated.json()).not.toHaveProperty('the_p')
    expect(updated.json()).not.toHaveProperty('seed_phrase')
    expect(updated.body).not.toContain(SERVICE_ROLE)
    expect(listed.body).not.toContain(SERVICE_ROLE)
  })

  it('a read PIN sees the list and does not change the record', async () => {
    const id = await seed('james@example.com', 'demo')

    const auth = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth',
      payload: { pin: '4200' },
    })
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { 'x-admin-pin': '4200' },
    })
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '4200' },
      payload: { balance: '99' },
    })
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '4200' },
    })

    expect(auth.statusCode).toBe(200)
    expect(auth.json<{ role: string }>()).toEqual({ ok: true, role: 'admin' })
    expect(listed.statusCode).toBe(200)
    expect(patched.statusCode).toBe(403)
    expect(removed.statusCode).toBe(403)
    expect(users.records[0]?.balance).toBe('0')
    expect(users.records).toHaveLength(1)
  })

  it('keeps the user response shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE },
    })

    expect(response.statusCode).toBe(201)
    expect(Object.keys(response.json<Record<string, unknown>>()).sort()).toEqual([
      'assets',
      'balance',
      'createdAt',
      'email',
      'id',
      'wallets',
    ])
    expect(response.body).not.toContain(SERVICE_ROLE)
    expect(response.body).not.toContain('demo')
  })
})
