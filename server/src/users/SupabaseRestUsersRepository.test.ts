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
              email: 'james@example.com',
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

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.supabase.co/rest/v1/users')
    expect(record.id).toBe('7')
    expect(record.email).toBe('james@example.com')
  })

  it('ищет запись по почте и the_p', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            {
              id: 7,
              created_at: '2026-08-19T12:00:00.000Z',
              email: 'james@example.com',
              balance: '12.5',
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

    const record = await users.findByCredentials({ email: 'james@example.com', theP: 'demo' })
    const requested = String(fetchMock.mock.calls[0]?.[0])

    expect(requested).toContain('/rest/v1/users')
    expect(requested).toContain('the_p=eq.demo')
    expect(requested).toContain('email=ilike.')
    expect(record?.email).toBe('james@example.com')
    expect(record?.balance).toBe('12.5')
  })

  it('ищет запись по id без колонки the_p', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            {
              id: 7,
              created_at: '2026-08-19T12:00:00.000Z',
              email: 'james@example.com',
              balance: '12.5',
            },
          ]),
        ),
    })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.findById('7')
    const requested = String(fetchMock.mock.calls[0]?.[0])

    expect(requested).toContain('/rest/v1/users')
    expect(requested).toContain('id=eq.7')
    expect(requested).toContain('select=id%2Ccreated_at%2Cemail%2Cbalance')
    expect(requested).not.toContain('the_p')
    expect(record?.id).toBe('7')
    expect(record?.email).toBe('james@example.com')
    expect(record?.theP).toBeNull()
  })

  it('возвращает null, если совпадения нет', async () => {
    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('[]'),
      }) as unknown as typeof fetch,
    })

    await expect(
      users.findByCredentials({ email: 'james@example.com', theP: 'missing' }),
    ).resolves.toBeNull()
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
      users.create({ email: 'james@example.com', balance: '0', theP: 'demo' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError)
  })
})
