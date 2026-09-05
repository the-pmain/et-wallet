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

describe('createEmailsStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses memory without Cloudflare keys', async () => {
    const store = await createEmailsStore({
      ...BASE_CONFIG,
      supabaseUrl: null,
      supabaseAnonKey: null,
    })

    expect(store.kind).toBe(EMAILS_STORE_KIND.Memory)
    expect(store.storageWarning).toBeNull()
  })

  it('does not use Supabase for mail when Cloudflare is present', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)

      if (url.includes('/zones?')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'zone-etwalletx', name: 'etwalletx.com' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      return new Response('[]', { status: 200 })
    })

    vi.stubGlobal('fetch', fetchMock)

    const store = await createEmailsStore(
      {
        ...BASE_CONFIG,
        cloudflareAccountId: 'account-id',
        cloudflareApiToken: 'token',
        mailFrom: 'support@etwalletx.com',
      },
      { ensureInbox: false },
    )

    expect(store.kind).toBe(EMAILS_STORE_KIND.Cloudflare)
    expect(store.storageWarning).toBeNull()
    expect(
      fetchMock.mock.calls.every((call) => !String(call[0]).includes('/rest/v1/emails')),
    ).toBe(true)
  })
})
