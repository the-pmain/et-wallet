import { describe, expect, it, vi } from 'vitest'

import { EMPTY_REMOTE_ASSETS } from '@/features/onboarding/model/RemoteUserDirectory'

import { AdminAuthError, AdminClient } from './AdminClient'

const KEY = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const USER = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: { 'address-receiving-funds': { key: KEY, value: '0' } },
  assets: EMPTY_REMOTE_ASSETS,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('AdminClient', () => {
  it('accepts a PIN and puts it in the list header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, role: 'super' }))
      .mockResolvedValueOnce(jsonResponse(200, { users: [USER] }))

    const client = new AdminClient({
      baseUrl: '',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(client.authenticate('9100')).resolves.toBe('super')
    const users = await client.listUsers()

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ pin: '9100' })
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-admin-pin': '9100' })
    expect(users[0]?.email).toBe('james@example.com')
  })

  it('reads the login activity list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        users: [
          {
            userId: '7',
            email: 'james@example.com',
            loginCount: 2,
            logins: [
              {
                id: 'e2',
                createdAt: '2026-09-08T12:04:21.000Z',
                timeZone: 'Europe/London',
                city: 'London',
                region: 'England',
                country: 'United Kingdom',
                countryCode: 'GB',
              },
              { id: 'e1', createdAt: '2026-09-07T08:12:03.000Z' },
            ],
          },
        ],
      }),
    )
    const client = new AdminClient({
      baseUrl: '',
      pin: '4200',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const activity = await client.listLoginActivity()

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/v1/admin/login-events')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-admin-pin': '4200' })
    expect(activity[0]).toMatchObject({
      userId: '7',
      email: 'james@example.com',
      loginCount: 2,
    })
    expect(activity[0]?.logins).toHaveLength(2)
    expect(activity[0]?.logins[0]).toMatchObject({
      city: 'London',
      country: 'United Kingdom',
      countryCode: 'GB',
    })
    expect(activity[0]?.logins[1]).toMatchObject({
      city: null,
      country: null,
    })
  })

  it('reads a directory sendings page with the joined email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: '62',
            createdAt: '2026-08-22T14:59:14.037Z',
            userId: '74',
            userEmail: 'leo@example.com',
            status: 'pending',
            failureMessage: null,
            recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
            amount: '4',
            symbol: 'ETH',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    )
    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const page = await client.listDirectorySendings({ page: 1, pageSize: 20, q: 'leo@' })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/v1/admin/directory/sendings?page=1&pageSize=20&q=leo%40',
    )
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      id: '62',
      userEmail: 'leo@example.com',
      amount: '4',
    })
  })

  it('shares one in-flight GET for the same directory page', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          queueMicrotask(() => {
            resolve(
              jsonResponse(200, {
                items: [],
                page: 1,
                pageSize: 20,
                total: 0,
              }),
            )
          })
        }),
    )
    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const query = { page: 1, pageSize: 20, q: '' }
    const [first, second] = await Promise.all([
      client.listDirectorySendings(query),
      client.listDirectorySendings(query),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.total).toBe(0)
    expect(second.total).toBe(0)

    await client.listDirectorySendings(query)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the sendings list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        sendings: [
          {
            id: '62',
            createdAt: '2026-08-22T14:59:14.037Z',
            userId: '74',
            status: 'pending',
            failureMessage: null,
            recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
            amount: '4',
            symbol: 'ETH',
          },
        ],
      }),
    )
    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const sendings = await client.listSendings()

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/v1/admin/sendings')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-admin-pin': '9100' })
    expect(sendings[0]).toMatchObject({
      id: '62',
      amount: '4',
      symbol: 'ETH',
    })
  })

  it('writes a sending edit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: '62',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '74',
        status: 'failure',
        failureMessage: 'Blocked by admin',
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '4',
        symbol: 'ETH',
      }),
    )
    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const updated = await client.updateSending('62', {
      status: 'failure',
      failureMessage: 'Blocked by admin',
      recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: '4',
      symbol: 'ETH',
    })

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/v1/admin/sendings/62')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      status: 'failure',
      failureMessage: 'Blocked by admin',
    })
    expect(updated.status).toBe('failure')
  })

  it('rejects a wrong PIN', async () => {
    const client = new AdminClient({
      baseUrl: '',
      fetch: vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: { code: 'unauthorized' } }),
        ) as unknown as typeof fetch,
    })

    await expect(client.authenticate('0000')).rejects.toBeInstanceOf(AdminAuthError)
  })

  it('changes a wallet value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...USER,
        wallets: { 'address-receiving-funds': { key: KEY, value: '2500' } },
      }),
    )

    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const updated = await client.updateUser('7', {
      wallets: { 'address-receiving-funds': { key: KEY, value: '2500' } },
    })

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      wallets: { 'address-receiving-funds': { key: KEY, value: '2500' } },
    })
    expect(updated.wallets['address-receiving-funds']?.value).toBe('2500')
  })
})
