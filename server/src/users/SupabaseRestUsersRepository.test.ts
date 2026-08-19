import { describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '../lib/errors.ts'

import { SupabaseRestUsersRepository } from './SupabaseRestUsersRepository.ts'

describe('SupabaseRestUsersRepository', () => {
  it('пишет в /rest/v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            {
              id: 7,
              created_at: '2026-08-19T12:00:00.000Z',
              username: 'James',
              balance: '0',
              the_p: 'demo',
            },
          ]),
        ),
    })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.create({ username: 'James', balance: '0', theP: 'demo' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.supabase.co/rest/v1/users')
    expect(record.id).toBe('7')
    expect(record.username).toBe('James')
  })

  it('пробрасывает отказ Supabase', async () => {
    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
      }) as unknown as typeof fetch,
    })

    await expect(
      users.create({ username: 'James', balance: '0', theP: 'demo' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError)
  })
})
