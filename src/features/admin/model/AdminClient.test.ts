import { describe, expect, it, vi } from 'vitest'

import { EMPTY_REMOTE_ASSETS } from '@/features/onboarding/model/RemoteUserDirectory'

import { AdminAuthError, AdminClient } from './AdminClient'

const KEY = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const USER = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [{ key: KEY, value: '0' }],
  assets: EMPTY_REMOTE_ASSETS,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('AdminClient', () => {
  it('принимает PIN и ставит его в заголовок списка', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { users: [USER] }))

    const client = new AdminClient({
      baseUrl: '',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.authenticate('9100')
    const users = await client.listUsers()

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ pin: '9100' })
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-admin-pin': '9100' })
    expect(users[0]?.email).toBe('james@example.com')
  })

  it('читает список sendings', async () => {
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

  it('пишет правку sending', async () => {
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

  it('отвергает неверный PIN', async () => {
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

  it('меняет значение кошелька', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...USER, wallets: [{ key: KEY, value: '2500' }] }))

    const client = new AdminClient({
      baseUrl: '',
      pin: '9100',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const updated = await client.updateUser('7', { wallets: [{ key: KEY, value: '2500' }] })

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      wallets: [{ key: KEY, value: '2500' }],
    })
    expect(updated.wallets[0]?.value).toBe('2500')
  })

  it('отправляет письмо', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        delivered: ['recipient@example.com'],
        queued: [],
        permanentBounces: [],
      }),
    )

    const client = new AdminClient({
      baseUrl: '',
      pin: '3100',
      authPath: '/v1/email-manager/auth',
      pinHeader: 'x-email-manager-pin',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.sendEmail({
      to: 'recipient@example.com',
      from: 'custom123@etwalletx.com',
      subject: 'Welcome!',
      html: '<h1>Hello</h1>',
      text: 'Hello',
    })

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/v1/admin/email/send')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-email-manager-pin': '3100',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      to: 'recipient@example.com',
      from: 'custom123@etwalletx.com',
      subject: 'Welcome!',
      html: '<h1>Hello</h1>',
      text: 'Hello',
    })
    expect(result.delivered).toEqual(['recipient@example.com'])
  })
})
