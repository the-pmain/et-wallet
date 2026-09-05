import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '../lib/errors.ts'

import {
  authenticateSupabaseBearerUser,
  createSupabaseAdminClient,
  createSupabaseUserClient,
  readBearerAuthorization,
  readSupabasePublishableKey,
  requireBearerAuthorization,
} from './supabase-clients.ts'

const USER_OPTIONS = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'publishable-key',
}

describe('supabase-clients', () => {
  it('takes publishable, else anon, and does not substitute service-role', () => {
    expect(readSupabasePublishableKey('publishable', 'anon')).toBe('publishable')
    expect(readSupabasePublishableKey(null, 'anon')).toBe('anon')
    expect(readSupabasePublishableKey(null, null)).toBeNull()
  })

  it('without Authorization and with an expired token returns 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ message: 'invalid JWT' })),
    })

    expect(await authenticateSupabaseBearerUser(undefined, USER_OPTIONS)).toEqual({
      statusCode: 401,
    })
    expect(await authenticateSupabaseBearerUser('Basic abc', USER_OPTIONS)).toEqual({
      statusCode: 401,
    })
    expect(
      await authenticateSupabaseBearerUser('Bearer expired-token', {
        ...USER_OPTIONS,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).toEqual({ statusCode: 401 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: 'publishable-key',
          authorization: 'Bearer expired-token',
        }),
      }),
    )
  })

  it('accepts a valid JWT and does not return extra Auth fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 'auth-1',
            email: 'james@example.com',
            role: 'authenticated',
            aud: 'authenticated',
          }),
        ),
    })

    await expect(
      authenticateSupabaseBearerUser('Bearer valid-token', {
        ...USER_OPTIONS,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      user: { id: 'auth-1', email: 'james@example.com' },
    })
  })

  it('does not put service-role into user-scoped headers', () => {
    const client = createSupabaseUserClient('Bearer user-jwt', USER_OPTIONS)

    expect(client.kind).toBe('user')
    expect(client.headers['apikey']).toBe('publishable-key')
    expect(client.headers['authorization']).toBe('Bearer user-jwt')
    expect(JSON.stringify(client.headers)).not.toContain('service-role')
  })

  it('the admin client uses service-role and marks the RLS bypass', () => {
    const client = createSupabaseAdminClient({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
    })

    expect(client.kind).toBe('admin')
    expect(client.headers['apikey']).toBe('service-role-key')
    expect(client.headers['authorization']).toBe('Bearer service-role-key')
  })

  it('accepts Bearer only', () => {
    expect(readBearerAuthorization(undefined)).toBeNull()
    expect(readBearerAuthorization('Bearer')).toBeNull()
    expect(readBearerAuthorization('Bearer user-jwt')).toBe('Bearer user-jwt')
    expect(() => requireBearerAuthorization(undefined)).toThrow(UnauthorizedError)
  })

  it('does not keep a service-role key in wallet source or the env example', () => {
    const frontend = readFileSync(
      join(import.meta.dirname, '../../../src/features/onboarding/model/RemoteUserDirectory.ts'),
      'utf8',
    )
    const adminClient = readFileSync(
      join(import.meta.dirname, '../../../src/features/admin/model/AdminClient.ts'),
      'utf8',
    )
    const envExample = readFileSync(join(import.meta.dirname, '../../../.env.example'), 'utf8')

    expect(frontend).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service.role/iu)
    expect(adminClient).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service.role/iu)
    expect(envExample).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=$/m)
    expect(envExample).not.toMatch(/VITE_SUPABASE_SERVICE_ROLE_KEY/u)
  })

  it('the RLS migration does not open public.sendings with USING (true)', () => {
    const sql = readFileSync(join(import.meta.dirname, '../../supabase/sendings-rls.sql'), 'utf8')

    expect(sql).toMatch(/enable row level security/u)
    expect(sql).toMatch(/drop policy if exists sendings_all/u)
    expect(sql).toMatch(/revoke all on table public\.sendings from anon, authenticated/u)
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/iu)
    expect(sql).not.toMatch(/with check\s*\(\s*true\s*\)/iu)
    expect(sql).not.toMatch(/create policy/iu)
  })

  it('the RLS migration does not open public.users with USING (true)', () => {
    const sql = readFileSync(join(import.meta.dirname, '../../supabase/users-rls.sql'), 'utf8')

    expect(sql).toMatch(/enable row level security/u)
    expect(sql).toMatch(/drop policy if exists users_all/u)
    expect(sql).toMatch(/revoke all on table public\.users from anon, authenticated/u)
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/iu)
    expect(sql).not.toMatch(/with check\s*\(\s*true\s*\)/iu)
    expect(sql).not.toMatch(/create policy/iu)
  })
})
