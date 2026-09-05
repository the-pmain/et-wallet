import { describe, expect, it } from 'vitest'

import { RUNTIME_MODE, type IServerConfig } from '../config.ts'

import { USERS_STORE_KIND } from './contracts.ts'
import { createUsersStore } from './createUsersStore.ts'

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
    adminPin: null,
    superAdminPin: null,
}

describe('createUsersStore', () => {
  it('without keys keeps users in memory', () => {
    const store = createUsersStore(BASE)

    expect(store.kind).toBe(USERS_STORE_KIND.Memory)
  })

  it('with URL and service-role writes to Supabase REST', () => {
    const store = createUsersStore({
      ...BASE,
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      supabaseServiceRoleKey: 'service-role',
    })

    expect(store.kind).toBe(USERS_STORE_KIND.Supabase)
  })

  it('refuses to start Supabase without a service-role key', () => {
    expect(() =>
      createUsersStore({
        ...BASE,
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon',
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/u)
  })
})
