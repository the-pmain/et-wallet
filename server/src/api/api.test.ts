import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { MemorySettingsRepository } from '../settings/MemorySettingsRepository.ts'
import { MemorySendingsRepository } from '../sendings/MemorySendingsRepository.ts'
import { SendingsHub } from '../sendings/SendingsHub.ts'
import { STARTING_TOKENS } from '../users/assets.ts'
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

const SYNC_ID = 'a'.repeat(64)

const SEED_PHRASE =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

function expectStartingAssets(assets: { quoteCurrency?: string; tokens?: unknown }): void {
  expect(assets.quoteCurrency).toBe('USD')
  expect(Object.keys(assets).sort()).toEqual(['quoteCurrency', 'tokens', 'updatedAt'])
  expect(JSON.stringify(assets)).not.toMatch(/priceUsd|valueUsd|totalValueUsd|change24hPercent/u)
  expect(assets.tokens).toEqual(STARTING_TOKENS)

  for (const token of assets.tokens as Record<string, unknown>[]) {
    expect(token['balance']).toBe('0')
    expect(token).not.toHaveProperty('priceUsd')
    expect(token).not.toHaveProperty('valueUsd')
    expect(token).not.toHaveProperty('change24hPercent')
  }
}

let app: FastifyInstance
let settings: MemorySettingsRepository
let users: MemoryUsersRepository
let sendings: MemorySendingsRepository
let sendingsHub: SendingsHub

beforeEach(async () => {
  settings = new MemorySettingsRepository()
  users = new MemoryUsersRepository()
  sendings = new MemorySendingsRepository()
  sendingsHub = new SendingsHub()
  app = await buildApp({
    config: CONFIG,
    settings,
    users,
    sendings,
    sendingsHub,
  })
})

afterEach(async () => {
  await app.close()
})

describe('Network catalog', () => {
  it('returns the network list', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ networks: unknown[] }>().networks.length).toBeGreaterThan(0)
  })

  it('sends the network id as a string', async () => {
    /* `JSON.parse` silently loses precision on large numbers, and a
       network that differs from the real one is a signature for another chain. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })
    const [first] = response.json<{ networks: { chainId: unknown }[] }>().networks

    expect(typeof first?.chainId).toBe('string')
  })

  it('allows catalog caching', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['cache-control']).toContain('max-age=300')
  })
})

describe('Recommended RPC', () => {
  it('returns nodes for a known network', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/rpc' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ endpoints: unknown[] }>().endpoints.length).toBeGreaterThan(0)
  })

  it('names the operator of each node', async () => {
    /* "It works" and "it works through a third-party operator who sees
       all your addresses" are different claims. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/rpc' })

    for (const endpoint of response.json<{ endpoints: { operator: string }[] }>().endpoints) {
      expect(endpoint.operator).not.toBe('')
    }
  })

  it('rejects an unknown network', async () => {
    /* An empty list for a missing network would read as "there are no nodes". */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/999999/rpc' })

    expect(response.statusCode).toBe(404)
  })

  it('rejects a non-numeric network id', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/abc/rpc' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an id with leading zeros', async () => {
    /* Two spellings of one network would give two cache keys at
       intermediaries and diverging responses. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/001/rpc' })

    expect(response.statusCode).toBe(400)
  })
})

describe('Recommended tokens', () => {
  it('returns tokens for a known network', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/tokens' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ tokens: unknown[] }>().tokens.length).toBeGreaterThan(0)
  })

  it('reports the provenance of each record', async () => {
    /* A "verified" flag is not checkable; origin is. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/1/tokens' })

    for (const token of response.json<{ tokens: { provenance: string[] }[] }>().tokens) {
      expect(token.provenance.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('returns an empty list for a network with no confirmed recommendations', async () => {
    /* The network is known, but its tokens were not checked against
       two sources. That is not the same as a missing network. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks/56/tokens' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ tokens: unknown[] }>().tokens).toEqual([])
  })

  it('rejects an unknown network', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/networks/999999/tokens' })

    expect(response.statusCode).toBe(404)
  })
})

describe('System notifications', () => {
  it('returns active notifications', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/notifications' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ notifications: unknown[] }>().notifications.length).toBeGreaterThan(0)
  })

  it('contains no links in any message', async () => {
    /* Text from here is shown inside the wallet and is indistinguishable
       from a message of the app itself. */
    const response = await app.inject({ method: 'GET', url: '/v1/notifications' })

    for (const item of response.json<{ notifications: { title: string; body: string }[] }>()
      .notifications) {
      expect(`${item.title} ${item.body}`).not.toMatch(/https?:\/\//u)
    }
  })
})

describe('Version check', () => {
  it('reports the latest and minimum supported versions', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ latest: string }>().latest).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  it('does not report a download URL', async () => {
    /* "Download the update from here" is a ready way to send the user
       to a fake installer. */
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })

    expect(response.body).not.toMatch(/https?:\/\//u)
  })

  it('leaves flags unknown when the client version is unreported', async () => {
    /* "We do not know" must not become "all is well" or "time to
       update". */
    const response = await app.inject({ method: 'GET', url: '/v1/app/version' })
    const body = response.json<{ isSupported: unknown; isOutdated: unknown }>()

    expect(body.isSupported).toBeNull()
    expect(body.isOutdated).toBeNull()
  })

  it('marks a version below latest as outdated', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version?version=0.0.1' })
    const body = response.json<{ isOutdated: boolean; isSupported: boolean }>()

    expect(body.isOutdated).toBe(true)
    expect(body.isSupported).toBe(false)
  })

  it('rejects a version with a pre-release tag', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/app/version?version=1.0.0-beta' })

    expect(response.statusCode).toBe(400)
  })
})

describe('Settings sync', () => {
  it('reports a missing record', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(response.statusCode).toBe(404)
  })

  it('stores and returns ciphertext unchanged', async () => {
    const written = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0', revision: 0 },
    })

    expect(written.statusCode).toBe(200)

    const read = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(read.json<{ ciphertext: string }>().ciphertext).toBe('c2VjcmV0')
  })

  it('forbids settings caching', async () => {
    /* These are one user's data, even if encrypted. */
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0', revision: 0 },
    })

    const read = await app.inject({ method: 'GET', url: `/v1/settings/${SYNC_ID}` })

    expect(read.headers['cache-control']).toBe('no-store')
  })

  it('rejects a write with a stale revision', async () => {
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

  it('rejects a short sync id', async () => {
    /* The id is a bearer key: it must be random and long, not convenient. */
    const response = await app.inject({ method: 'GET', url: '/v1/settings/abc' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an unknown field in the request body', async () => {
    /* A buggy client must not be able to silently pass the service
       something it must not accept. */
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0, mnemonic: 'something' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('deletes the record', async () => {
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

  it('deleting a missing record is not an error', async () => {
    /* Otherwise the response would tell someone guessing the id
       whether a record exists. */
    const response = await app.inject({ method: 'DELETE', url: `/v1/settings/${SYNC_ID}` })

    expect(response.statusCode).toBe(204)
  })
})

describe('Users', () => {
  it('writes email, balance and the_p', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', balance: '0', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    expect(response.statusCode).toBe(201)
    expect(
      response.json<{ email: string; balance: string; wallets: Record<string, string> }>().email,
    ).toBe('james@example.com')
    expect(response.json<{ wallets: unknown[] }>().wallets).toEqual([])
    expectStartingAssets(
      response.json<{ assets: { quoteCurrency: string; tokens: unknown } }>().assets,
    )
    expect(response.json<{ the_p?: unknown; password?: unknown }>()).not.toHaveProperty('the_p')
    expect(response.json<{ password?: unknown }>()).not.toHaveProperty('password')
    expect(response.json<{ username?: unknown }>()).not.toHaveProperty('username')
    expect(users.records).toHaveLength(1)
    expect(users.records[0]?.theP).toBe('demo')
    expect(users.records[0]?.seedPhrase).toBe(SEED_PHRASE)
    expect(users.records[0]?.wallets).toEqual([])
    expectStartingAssets(users.records[0]?.assets ?? { tokens: [] })
    expect(response.json<{ seed_phrase?: unknown; seedPhrase?: unknown }>()).not.toHaveProperty(
      'seed_phrase',
    )
    expect(response.json<{ seedPhrase?: unknown }>()).not.toHaveProperty('seedPhrase')
  })

  it('accepts assets from the body, zeros balances and does not store price', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-20T12:00:00.000Z',
          tokens: STARTING_TOKENS.map((token) => ({
            ...token,
            balance: '1284700000000000000',
          })),
        },
      },
    })

    expect(response.statusCode).toBe(201)
    expectStartingAssets(
      response.json<{ assets: { quoteCurrency: string; tokens: unknown } }>().assets,
    )
    expectStartingAssets(users.records[0]?.assets ?? { tokens: [] })
  })

  it('rejects priceUsd and valueUsd in the create body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-20T12:00:00.000Z',
          tokens: [
            {
              ...STARTING_TOKENS[0],
              priceUsd: '3284.12',
              valueUsd: '4219.11',
            },
          ],
        },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('writes wallets from the create body', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const entry = { key, value: '0' }
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        wallets: entry,
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ wallets: (typeof entry)[] }>().wallets).toEqual([entry])
    expect(users.records[0]?.wallets).toEqual([entry])
  })

  it('writes a wallets list from the create body', async () => {
    const first = {
      key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      value: '0',
    }
    const second = {
      key: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      value: '0',
    }
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        wallets: [first, second],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ wallets: unknown[] }>().wallets).toEqual([first, second])
  })

  it('rejects wallets whose key is not an address', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        wallets: { key: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', value: '0' },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('fills a zero balance when none was sent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'maria@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ balance: string }>().balance).toBe('0')
  })

  it('on create zeros the balance and wallet values', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        balance: '12.5',
        wallets: { key, value: '2500' },
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ balance: string }>().balance).toBe('0')
    expect(response.json<{ wallets: { value: string }[] }>().wallets).toEqual([{ key, value: '0' }])
    expectStartingAssets(
      response.json<{ assets: { quoteCurrency: string; tokens: unknown } }>().assets,
    )
  })

  it('forbids response caching', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('accepts an email up to 254 characters', async () => {
    /* No consecutive hex characters: the inbound-data guard would
       take them for a private key. */
    const email = `${'q'.repeat(64)}@${'z'.repeat(176)}.io`

    expect(email.length).toBeLessThanOrEqual(254)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email, the_p: '123456', seed_phrase: SEED_PHRASE},
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ email: string }>().email).toBe(email)
  })

  it('rejects create with username instead of email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'james@example.com', the_p: '123456' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_request')
  })

  it('rejects create without seed_phrase', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo' },
    })

    expect(response.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('rejects a space-separated seed phrase', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('rejects seed_phrase with a bad checksum', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase:
          'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(users.records).toHaveLength(0)
  })

  it('lets in when email and the_p match', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', balance: '12.5', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/auth',
      payload: { email: 'james@example.com', the_p: 'demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      email: 'james@example.com',
      balance: '0',
    })
    expectStartingAssets(
      response.json<{ assets: { quoteCurrency: string; tokens: unknown } }>().assets,
    )
    expect(response.json<{ the_p?: unknown }>()).not.toHaveProperty('the_p')
    expect(response.body).not.toContain('demo')
  })

  it('returns fresh assets on GET /v1/users/:id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${userId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-22T16:00:00.000Z',
          tokens: [
            {
              chainId: '1',
              standard: 'native',
              address: null,
              symbol: 'ETH',
              name: 'Ether',
              decimals: 18,
              balance: '832117000000000000',
              isVerified: true,
            },
          ],
        },
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}`,
      query: { email: 'james@example.com', the_p: 'demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json<{ assets: { tokens: { balance: string; symbol: string }[] } }>().assets.tokens[0]).toMatchObject({
      symbol: 'ETH',
      balance: '832117000000000000',
    })
    expect(response.json<{ the_p?: unknown }>()).not.toHaveProperty('the_p')
  })

  it('does not serve GET /v1/users/:id without email and the_p', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const missing = await app.inject({ method: 'GET', url: `/v1/users/${userId}` })
    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}`,
      query: { email: 'james@example.com', the_p: 'wrong' },
    })

    expect(missing.statusCode).toBe(400)
    expect(wrong.statusCode).toBe(401)
  })

  it('writes the created address into wallets', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/wallets',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        key,
        value: '0',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ wallets: { key: string; value: string }[] }>().wallets).toEqual([
      { key, value: '0' },
    ])
    expect(response.json<{ the_p?: unknown }>()).not.toHaveProperty('the_p')
    expect(users.records[0]?.wallets).toEqual([{ key, value: '0' }])
  })

  it('registers a send with pending status', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      status: 'pending',
      recipientAddress: recipient,
      amount: '1',
      symbol: 'ETH',
      failureMessage: null,
    })
    expect(sendings.records).toHaveLength(1)
    expect(sendings.records[0]?.status).toBe('pending')
    expect(sendings.records[0]?.userId).toBe(userId)
    expect(sendings.records[0]?.symbol).toBe('ETH')
  })

  it('returns the owner sendings on GET /v1/users/:id/sendings', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const other = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'other@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const otherId = other.json<{ id: string }>().id

    await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'ETH',
      },
    })

    await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: otherId,
        email: 'other@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '9',
        symbol: 'USDT',
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}/sendings`,
      query: { email: 'james@example.com', the_p: 'demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json<{ sendings: { userId: string; amount: string; symbol: string }[] }>().sendings).toEqual([
      expect.objectContaining({
        userId,
        amount: '1',
        symbol: 'ETH',
      }),
    ])
  })

  it('does not serve GET /v1/users/:id/sendings without email and the_p', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const missing = await app.inject({ method: 'GET', url: `/v1/users/${userId}/sendings` })
    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}/sendings`,
      query: { email: 'james@example.com', the_p: 'wrong' },
    })

    expect(missing.statusCode).toBe(400)
    expect(wrong.statusCode).toBe(401)
  })

  it('rejects create without symbol', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(sendings.records).toHaveLength(0)
  })

  it('after a successful create sends a sendings frame with type_send create', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const received: unknown[] = []

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id
    sendingsHub.subscribe(userId, (event) => {
      received.push(event)
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(received).toEqual([
      {
        ...response.json(),
        type_send: 'create',
      },
    ])
  })

  it('does not send a frame when create is rejected', async () => {
    const received: unknown[] = []

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    sendingsHub.subscribe(created.json<{ id: string }>().id, (event) => {
      received.push(event)
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: '1',
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: '0x123',
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(received).toEqual([])
  })

  it('GET /v1/sendings holds the stream and yields a frame after create', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const controller = new AbortController()
    const stream = await fetch(`${address}/v1/sendings?user_id=${userId}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })

    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/i)

    const reader = stream.body?.getReader()
    expect(reader).toBeDefined()

    const decoder = new TextDecoder()
    const chunks: string[] = []
    const reading = (async () => {
      if (reader === undefined) {
        return
      }

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        chunks.push(decoder.decode(value, { stream: true }))

        if (chunks.join('').includes('type_send')) {
          break
        }
      }
    })()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)
    await reading

    controller.abort()

    const body = chunks.join('')
    expect(body).toContain('event: sendings')
    expect(body).toContain('"type_send":"create"')
    expect(body).toContain(`"userId":"${userId}"`)
    expect(body).toContain(recipient)
  })

  it('GET /v1/sendings without user_id yields a frame for any new record', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const controller = new AbortController()
    const stream = await fetch(`${address}/v1/sendings`, {
      headers: { Accept: 'text/event-stream', 'x-admin-pin': '9100' },
      signal: controller.signal,
    })

    expect(stream.status).toBe(200)

    const reader = stream.body?.getReader()
    expect(reader).toBeDefined()

    const decoder = new TextDecoder()
    const chunks: string[] = []
    const reading = (async () => {
      if (reader === undefined) {
        return
      }

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        chunks.push(decoder.decode(value, { stream: true }))

        if (chunks.join('').includes('type_send')) {
          break
        }
      }
    })()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '2',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(201)
    await reading

    controller.abort()

    const body = chunks.join('')
    expect(body).toContain('event: sendings')
    expect(body).toContain('"type_send":"create"')
    expect(body).toContain(`"userId":"${userId}"`)
    expect(body).toContain('"amount":"2"')
    expect(body).toContain(recipient)
  })

  it('GET /v1/sendings without user_id does not open the stream on a read PIN', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const denied = await fetch(`${address}/v1/sendings`, {
      headers: { Accept: 'text/event-stream' },
    })
    const reader = await fetch(`${address}/v1/sendings`, {
      headers: { Accept: 'text/event-stream', 'x-admin-pin': '4200' },
    })

    expect(denied.status).toBe(401)
    expect(reader.status).toBe(403)
  })

  it('rejects a send when user_id does not match the record', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: '999',
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(sendings.records).toHaveLength(0)
  })

  it('writes failure for a bad recipient address', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: '1',
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: '0x123',
        amount: '1',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects amount with a ticker — the column is a number only', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: '1',
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1 ETH',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('a new address in wallets always starts at zero', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/wallets',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        key,
        value: '2500',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ wallets: { value: string }[] }>().wallets).toEqual([{ key, value: '0' }])
  })

  it('refuses to write an address when the_p is wrong', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/wallets',
      payload: {
        email: 'james@example.com',
        the_p: 'other',
        key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        value: 'Account 1',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(users.records[0]?.wallets).toEqual([])
  })

  it('rejects a key that is not an address', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/wallets',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        key: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        value: 'Account 1',
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses when the_p does not match', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/auth',
      payload: { email: 'james@example.com', the_p: 'other' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unauthorized')
  })
})

describe('Inbound-data guard', () => {
  it('rejects a body that contains a private key', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: `0x${'a1'.repeat(32)}`, revision: 0 },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('secret_material_rejected')
  })

  it('rejects a body that contains a mnemonic', async () => {
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

  it('does not store a rejected body', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: `0x${'a1'.repeat(32)}`, revision: 0 },
    })

    expect(await settings.get(SYNC_ID)).toBeNull()
  })

  it('lets ordinary ciphertext through', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'c2VjcmV0LXNldHRpbmdz', revision: 0 },
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('Service-wide behavior', () => {
  it('answers the liveness check', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' })

    expect(response.statusCode).toBe(200)
  })

  it('rejects a missing route', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/no-such-route' })

    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('does not accept a write via POST', async () => {
    /* The allowed-methods list is limited: the service has no route
       that accepts arbitrary data. */
    const response = await app.inject({
      method: 'POST',
      url: `/v1/settings/${SYNC_ID}`,
      payload: { ciphertext: 'YQ==', revision: 0 },
    })

    expect(response.statusCode).toBe(404)
  })

  it('forbids framing from anywhere', async () => {
    /* Default `SAMEORIGIN` allows same-origin framing. The service
       has nothing to show in a frame under any condition. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['x-frame-options']).toBe('DENY')
  })

  it('does not allow script execution via the security policy', async () => {
    /* Helmet defaults are for a site and allow `script-src 'self'`
       plus `'unsafe-inline'` for styles. A JSON service needs none
       of that. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })
    const policy = String(response.headers['content-security-policy'])

    expect(policy).toContain("default-src 'none'")
    expect(policy).not.toContain('script-src')
    expect(policy).not.toContain('unsafe-inline')
  })

  it('forbids content-type sniffing', async () => {
    /* A JSON response the browser treats as HTML is a known path
       to running foreign code. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('forbids indexing of API responses', async () => {
    /* JSON carries no robots meta tag. Without the header the
       network catalog could be indexed via a direct link. */
    const response = await app.inject({ method: 'GET', url: '/v1/networks' })

    expect(response.headers['x-robots-tag']).toBe(
      'noindex, nofollow, noarchive, nosnippet, noimageindex',
    )
  })

  it('allows a PATCH CORS preflight from the cabinet to Vite', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/admin/users/51',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type,x-admin-pin',
      },
    })

    expect(response.statusCode).toBe(204)
    expect(String(response.headers['access-control-allow-methods'])).toContain('PATCH')
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-admin-pin',
    )
  })
})

describe('Admin cabinet', () => {
  const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

  async function seedUser(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {
        email: 'james@example.com',
        the_p: 'demo',
        seed_phrase: SEED_PHRASE,
        wallets: { key, value: '0' },
      },
    })

    return response.json<{ id: string }>().id
  }

  it('accepts the environment PIN and rejects another', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth',
      payload: { pin: '9100' },
    })
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth',
      payload: { pin: '0000' },
    })

    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true, role: 'super' })
    expect(denied.statusCode).toBe(401)
  })

  it('does not return the list without a PIN', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/users' })

    expect(response.statusCode).toBe(401)
  })

  it('does not return sendings without a PIN', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/sendings' })

    expect(response.statusCode).toBe(401)
  })

  it('returns sendings with a PIN', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '4',
        symbol: 'ETH',
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/sendings',
      headers: { 'x-admin-pin': '9100' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ sendings: { symbol: string; amount: string }[] }>().sendings[0]).toMatchObject({
      amount: '4',
      symbol: 'ETH',
      recipientAddress: recipient,
      userId,
    })
  })

  it('PATCH /v1/admin/sendings/:id writes fields and sends a type_send update frame', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id
    const sending = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '4',
        symbol: 'ETH',
      },
    })
    const sendingId = sending.json<{ id: string }>().id
    const received: unknown[] = []
    sendingsHub.subscribe(userId, (event) => {
      received.push(event)
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sendingId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'failure',
        failureMessage: 'Blocked by admin',
        recipientAddress: recipient,
        amount: '4',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: sendingId,
      status: 'failure',
      failureMessage: 'Blocked by admin',
      symbol: 'ETH',
    })
    expect(received).toEqual([
      {
        ...response.json(),
        type_send: 'update',
      },
    ])
  })

  it('PATCH success debits amount from users.assets.tokens and does not debit twice', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${userId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-20T12:00:00.000Z',
          tokens: [
            {
              chainId: '1',
              standard: 'native',
              address: null,
              symbol: 'ETH',
              name: 'Ether',
              decimals: 18,
              balance: '41000000000000000',
              isVerified: true,
            },
          ],
        },
      },
    })

    const sending = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '0.01',
        symbol: 'ETH',
      },
    })
    const sendingId = sending.json<{ id: string }>().id

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sendingId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'success',
        failureMessage: null,
        recipientAddress: recipient,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'success', amount: '0.01', symbol: 'ETH' })
    expect(users.records[0]?.assets.tokens[0]?.balance).toBe('31000000000000000')

    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sendingId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'success',
        failureMessage: null,
        recipientAddress: recipient,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(users.records[0]?.assets.tokens[0]?.balance).toBe('31000000000000000')
  })

  it('PATCH failure does not debit tokens', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${userId}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-20T12:00:00.000Z',
          tokens: [
            {
              chainId: '1',
              standard: 'native',
              address: null,
              symbol: 'ETH',
              name: 'Ether',
              decimals: 18,
              balance: '41000000000000000',
              isVerified: true,
            },
          ],
        },
      },
    })

    const sending = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/sendings/${sending.json<{ id: string }>().id}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        status: 'failure',
        failureMessage: 'Blocked',
        recipientAddress: recipient,
        amount: '0.01',
        symbol: 'ETH',
      },
    })

    expect(users.records[0]?.assets.tokens[0]?.balance).toBe('41000000000000000')
  })

  it('rejects an unknown transfer symbol', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: 'james@example.com', the_p: 'demo', seed_phrase: SEED_PHRASE},
    })
    const userId = created.json<{ id: string }>().id

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/sendings',
      payload: {
        user_id: userId,
        email: 'james@example.com',
        the_p: 'demo',
        recipient_address: recipient,
        amount: '1',
        symbol: 'BTC',
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns every user with a PIN', async () => {
    await seedUser()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { 'x-admin-pin': '9100' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ users: { email: string }[] }>().users[0]?.email).toBe(
      'james@example.com',
    )
    expect(response.json<{ users: { the_p?: unknown }[] }>().users[0]).not.toHaveProperty('the_p')
  })

  it('changes the wallet value and balance', async () => {
    const id = await seedUser()
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '9100' },
      payload: {
        balance: '42.5',
        wallets: [{ key, value: '2500' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ balance: string }>().balance).toBe('42.5')
    expect(response.json<{ wallets: { value: string }[] }>().wallets[0]?.value).toBe('2500')
    expect(users.records[0]?.wallets[0]?.value).toBe('2500')
  })

  it('deletes a user', async () => {
    const id = await seedUser()
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/users/${id}`,
      headers: { 'x-admin-pin': '9100' },
    })

    expect(response.statusCode).toBe(204)
    expect(users.records).toHaveLength(0)
  })
})
