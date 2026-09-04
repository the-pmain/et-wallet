import { afterEach, describe, expect, it, vi } from 'vitest'

import { RUNTIME_MODE, type IServerConfig } from '../config.ts'

import { SENDINGS_STORE_KIND } from './contracts.ts'
import { createSendingsStore } from './createSendingsStore.ts'

const BASE: IServerConfig = {
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

describe('createSendingsStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('без ключей держит переводы в памяти', async () => {
    const store = await createSendingsStore(BASE)

    expect(store.kind).toBe(SENDINGS_STORE_KIND.Memory)
  })

  it('при URL и service-role пишет в Supabase REST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('[]'),
    })

    vi.stubGlobal('fetch', fetchMock)

    const store = await createSendingsStore({
      ...BASE,
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      supabaseServiceRoleKey: 'service-role',
    })

    expect(store.kind).toBe(SENDINGS_STORE_KIND.Supabase)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        authorization: 'Bearer service-role',
      }),
    })
  })

  it('отказывается стартовать Supabase без service-role ключа', async () => {
    await expect(
      createSendingsStore({
        ...BASE,
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon',
      }),
    ).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/u)
  })
})
