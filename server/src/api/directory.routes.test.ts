import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { MemoryLoginEventsRepository } from '../login-events/MemoryLoginEventsRepository.ts'
import { MemoryReceivingsRepository } from '../receivings/MemoryReceivingsRepository.ts'
import { MemorySendingsRepository } from '../sendings/MemorySendingsRepository.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
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
  mailFrom: 'support@etwalletx.com',
  r2AccessKeyId: null,
  r2SecretAccessKey: null,
  r2Endpoint: null,
  r2Bucket: null,
  emailWebhookSecret: 'webhook-secret',
  adminPin: null,
  superAdminPin: null,
}

const RECIPIENT = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

describe('admin directory pages', () => {
  let app: FastifyInstance
  let users: MemoryUsersRepository
  let sendings: MemorySendingsRepository
  let receivings: MemoryReceivingsRepository
  let loginEvents: MemoryLoginEventsRepository

  beforeEach(async () => {
    users = new MemoryUsersRepository()
    sendings = new MemorySendingsRepository()
    receivings = new MemoryReceivingsRepository()
    loginEvents = new MemoryLoginEventsRepository()
    app = await buildApp({
      config: CONFIG,
      users,
      sendings,
      receivings,
      loginEvents,
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('does not return a directory page without a PIN', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/directory/sendings' })

    expect(response.statusCode).toBe(401)
  })

  it('returns an empty sendings page for a read PIN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/sendings',
      headers: { 'x-admin-pin': '4200' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })
  })

  it('joins email, searches, and pages sendings in one answer', async () => {
    const leo = await users.create({ email: 'leo@example.com', balance: '0', theP: 'leo' })
    const james = await users.create({ email: 'james@example.com', balance: '0', theP: 'james' })

    for (let index = 0; index < 21; index += 1) {
      await sendings.create({
        userId: index === 0 ? james.id : leo.id,
        recipientAddress: RECIPIENT,
        amount: index === 0 ? '9' : '1',
        symbol: 'ETH',
      })
    }

    const first = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/sendings?page=1&pageSize=20',
      headers: { 'x-admin-pin': '4200' },
    })
    const second = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/sendings?page=2&pageSize=20',
      headers: { 'x-admin-pin': '4200' },
    })
    const search = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/sendings?q=james@',
      headers: { 'x-admin-pin': '9100' },
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ page: 1, pageSize: 20, total: 21 })
    expect(first.json<{ items: unknown[] }>().items).toHaveLength(20)
    expect(first.json<{ items: { userEmail: string }[] }>().items[0]?.userEmail).toBe(
      'leo@example.com',
    )

    expect(second.json()).toMatchObject({ page: 2, pageSize: 20, total: 21 })
    expect(second.json<{ items: unknown[] }>().items).toHaveLength(1)

    expect(search.json()).toMatchObject({ total: 1, page: 1 })
    expect(search.json<{ items: { userEmail: string; amount: string }[] }>().items[0]).toMatchObject(
      {
        userEmail: 'james@example.com',
        amount: '9',
      },
    )

    const pending = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/sendings?status=pending',
      headers: { 'x-admin-pin': '4200' },
    })

    expect(pending.json()).toMatchObject({ total: 21, page: 1 })
  })

  it('joins email onto a receivings page', async () => {
    const james = await users.create({ email: 'james@example.com', balance: '0', theP: 'james' })
    await receivings.create({
      userId: james.id,
      status: SENDING_STATUS.Success,
      recipientAddress: RECIPIENT,
      amount: '1000',
      symbol: 'USDT',
      usdAmount: '999.87',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/receivings',
      headers: { 'x-admin-pin': '4200' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [
        {
          userEmail: 'james@example.com',
          amount: '1000',
          symbol: 'USDT',
          usdAmount: '999.87',
          recipientAddress: RECIPIENT,
        },
      ],
    })
  })

  it('pages users and activity from the directory', async () => {
    const james = await users.create({ email: 'james@example.com', balance: '1', theP: 'a' })
    await users.create({ email: 'maria@example.com', balance: '0', theP: 'b' })
    await loginEvents.create({
      userId: james.id,
      city: 'London',
      country: 'United Kingdom',
    })

    const userPage = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/users?pageSize=1',
      headers: { 'x-admin-pin': '4200' },
    })
    const activity = await app.inject({
      method: 'GET',
      url: '/v1/admin/directory/activity?q=london',
      headers: { 'x-admin-pin': '4200' },
    })

    expect(userPage.json()).toMatchObject({ total: 2, page: 1, pageSize: 1 })
    expect(userPage.json<{ items: unknown[] }>().items).toHaveLength(1)
    expect(activity.json()).toMatchObject({ total: 1 })
    expect(activity.json<{ items: { email: string }[] }>().items[0]?.email).toBe(
      'james@example.com',
    )
  })
})
