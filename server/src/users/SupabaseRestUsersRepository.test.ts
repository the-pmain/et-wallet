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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      email: 'james@example.com',
      balance: '0',
      the_p: 'demo',
      wallets: [],
      assets: expect.objectContaining({
        quoteCurrency: 'USD',
        tokens: expect.any(Array),
      }),
    })
    expect(record.id).toBe('7')
    expect(record.email).toBe('james@example.com')
  })

  it('передаёт заданный список wallets при создании', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
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
              wallets: [{ key, value: '0' }],
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
      wallets: [{ key, value: '0' }],
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).wallets).toEqual([
      { key, value: '0' },
    ])
    expect(record.wallets).toEqual([{ key, value: '0' }])
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

  it('пишет адрес через PATCH в wallets', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
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
                wallets: [],
              },
            ]),
          ),
      })
      .mockResolvedValueOnce({
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
                wallets: [{ key, value: '0' }],
              },
            ]),
          ),
      })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      key,
      value: '0',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('id=eq.7')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      wallets: [{ key, value: '0' }],
    })
    expect(record?.wallets).toEqual([{ key, value: '0' }])
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
    expect(requested).toContain('select=id%2Ccreated_at%2Cemail%2Cbalance%2Cwallets%2Cassets')
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

  it('читает все записи без колонки the_p', async () => {
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
              wallets: [],
            },
          ]),
        ),
    })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const listed = await users.list()
    const requested = String(fetchMock.mock.calls[0]?.[0])

    expect(requested).toContain('/rest/v1/users')
    expect(requested).toContain('order=created_at.desc')
    expect(requested).not.toContain('the_p')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.email).toBe('james@example.com')
  })

  it('меняет wallets по id', async () => {
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                id: 7,
                created_at: '2026-08-19T12:00:00.000Z',
                email: 'james@example.com',
                balance: '0',
                wallets: [{ key, value: '0' }],
              },
            ]),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                id: 7,
                created_at: '2026-08-19T12:00:00.000Z',
                email: 'james@example.com',
                balance: '0',
                wallets: [{ key, value: '2500' }],
              },
            ]),
          ),
      })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.update('7', { wallets: [{ key, value: '2500' }] })

    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      wallets: [{ key, value: '2500' }],
    })
    expect(record?.wallets).toEqual([{ key, value: '2500' }])
  })

  it('удаляет запись по id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                id: 7,
                created_at: '2026-08-19T12:00:00.000Z',
                email: 'james@example.com',
                balance: '0',
              },
            ]),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(users.remove('7')).resolves.toBe(true)
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})
