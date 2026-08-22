import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IServerConfig } from '../config.ts'
import { EMAILS_STORE_KIND } from './contracts.ts'
import { createEmailsStore } from './createEmailsStore.ts'

const BASE_CONFIG: IServerConfig = {
  mode: 'development',
  host: '127.0.0.1',
  port: 8080,
  allowedOrigins: [],
  rateLimit: { max: 120, windowMs: 60_000 },
  maxBodyBytes: 65_536,
  catalogCacheSeconds: 300,
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  staticRoot: null,
  cloudflareAccountId: null,
  cloudflareApiToken: null,
  cloudflareAuthEmail: null,
  emailWebhookSecret: null,
}

describe('createEmailsStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('использует память без Supabase', async () => {
    const store = await createEmailsStore({
      ...BASE_CONFIG,
      supabaseUrl: null,
      supabaseAnonKey: null,
    })

    expect(store.kind).toBe(EMAILS_STORE_KIND.Memory)
    expect(store.storageWarning).toBeNull()
  })

  it('использует Supabase, если таблица emails доступна', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200 })),
    )

    const store = await createEmailsStore(BASE_CONFIG)

    expect(store.kind).toBe(EMAILS_STORE_KIND.Supabase)
    expect(store.storageWarning).toBeNull()
  })

  it('переходит в память, если public.emails отсутствует', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'PGRST205',
            message: "Could not find the table 'public.emails' in the schema cache",
          }),
          { status: 404 },
        ),
      ),
    )

    const store = await createEmailsStore(BASE_CONFIG)

    expect(store.kind).toBe(EMAILS_STORE_KIND.Memory)
    expect(store.storageWarning).toContain('public.emails')
  })
})
