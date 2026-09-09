import { describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '../lib/errors.ts'

import {
  SupabaseRestUsersRepository,
  UsersDatabaseError,
} from './SupabaseRestUsersRepository.ts'
import { WALLET_CODENAME_RECEIVING_FUNDS } from './wallets.ts'

const WALLET_MAP = (key: string, value: string) => ({
  [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value },
})

describe('SupabaseRestUsersRepository', () => {
  it('writes to /rest/v1/users', async () => {
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
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.supabase.co/rest/v1/users')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        apikey: 'service-role',
        authorization: 'Bearer service-role',
      }),
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      email: 'james@example.com',
      balance: '0',
      the_p: 'demo',
      wallets: {},
      seed_phrase: null,
      assets: expect.objectContaining({
        quoteCurrency: 'USD',
        tokens: [],
      }),
    })
    expect(record.id).toBe('7')
    expect(record.email).toBe('james@example.com')
  })

  it('passes the given wallets list on create', async () => {
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
              wallets: WALLET_MAP(key, '0'),
            },
          ]),
        ),
    })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: WALLET_MAP(key, '0'),
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).wallets).toEqual(
      WALLET_MAP(key, '0'),
    )
    expect(record.wallets).toEqual(WALLET_MAP(key, '0'))
  })

  it('looks up a record by email and the_p', async () => {
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
      serviceRoleKey: 'service-role',
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

  it('writes an address via PATCH into wallets', async () => {
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
                wallets: {},
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
                wallets: WALLET_MAP(key, '0'),
              },
            ]),
          ),
      })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS,
      key,
      value: '0',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('id=eq.7')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      wallets: WALLET_MAP(key, '0'),
    })
    expect(record?.wallets).toEqual(WALLET_MAP(key, '0'))
  })

  it('looks up a record by id without column the_p', async () => {
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
      serviceRoleKey: 'service-role',
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

  it('returns null when there is no match', async () => {
    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('[]'),
      }) as unknown as typeof fetch,
    })

    await expect(
      users.findByCredentials({ email: 'james@example.com', theP: 'missing' }),
    ).resolves.toBeNull()
  })

  it('forwards a Supabase refusal', async () => {
    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
      }) as unknown as typeof fetch,
    })

    const failure = users.create({ email: 'james@example.com', balance: '0', theP: 'demo' })

    await expect(failure).rejects.toBeInstanceOf(UsersDatabaseError)
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableError)
    await expect(failure).rejects.toMatchObject({
      message: 'Database is unavailable.',
      operation: 'create',
    })
  })

  it('reads every record without column the_p', async () => {
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
              wallets: {},
            },
          ]),
        ),
    })

    const users = new SupabaseRestUsersRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
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

  it('changes wallets by id', async () => {
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
                wallets: WALLET_MAP(key, '0'),
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
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await users.update('7', { wallets: WALLET_MAP(key, '2500') })

    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      wallets: WALLET_MAP(key, '2500'),
    })
    expect(record?.wallets).toEqual(WALLET_MAP(key, '2500'))
  })

  it('deletes a record by id', async () => {
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
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(users.remove('7')).resolves.toBe(true)
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})
