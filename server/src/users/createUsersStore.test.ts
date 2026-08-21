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
  staticRoot: null,
  cloudflareAccountId: null,
  cloudflareApiToken: null,
  cloudflareAuthEmail: null,
}

describe('createUsersStore', () => {
  it('без ключей держит пользователей в памяти', () => {
    const store = createUsersStore(BASE)

    expect(store.kind).toBe(USERS_STORE_KIND.Memory)
  })

  it('при URL и ключе пишет в Supabase REST', () => {
    const store = createUsersStore({
      ...BASE,
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
    })

    expect(store.kind).toBe(USERS_STORE_KIND.Supabase)
  })
})
