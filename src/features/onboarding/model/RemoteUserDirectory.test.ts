import { describe, expect, it, vi } from 'vitest'

import { NullLogger } from '@/test/doubles'

import { createStartingRemoteAssets, STARTING_REMOTE_TOKENS } from '../lib/starting-assets'
import {
  EMPTY_REMOTE_ASSETS,
  INITIAL_WALLET_VALUE,
  RemoteAuthError,
  RemoteUserDirectory,
  WALLET_CODENAME_RECEIVING_FUNDS,
} from './RemoteUserDirectory'

const WALLET = {
  key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  value: INITIAL_WALLET_VALUE,
}

const WALLETS = {
  [WALLET_CODENAME_RECEIVING_FUNDS]: WALLET,
} as const

const ASSETS = createStartingRemoteAssets(new Date('2026-08-20T12:00:00.000Z'))

const SEED_PHRASE =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

const REGISTER = {
  email: 'james@example.com',
  balance: '0',
  theP: 'demo',
  wallets: WALLETS,
  assets: ASSETS,
  seedPhrase: SEED_PHRASE,
} as const

const USER_BODY = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-19T12:00:00.000Z',
  wallets: WALLETS,
  assets: EMPTY_REMOTE_ASSETS,
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

describe('RemoteUserDirectory', () => {
  it('posts to the given URL and returns the created record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.register(REGISTER)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      balance: '0',
      the_p: 'demo',
      wallets: WALLETS,
      assets: ASSETS,
      seed_phrase: SEED_PHRASE,
    })
    expect(ASSETS.tokens.every((token) => token.balance === '0')).toBe(true)
    expect(JSON.stringify(ASSETS)).not.toMatch(/priceUsd|valueUsd|totalValueUsd|change24hPercent/u)
    expect(ASSETS.tokens).toEqual(STARTING_REMOTE_TOKENS)
    expect(user).toEqual(USER_BODY)
  })

  it('strips priceUsd and valueUsd from the record showcase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        ...USER_BODY,
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-20T12:00:00.000Z',
          totalValueUsd: '14790.76',
          tokens: [
            {
              chainId: '1',
              standard: 'native',
              address: null,
              symbol: 'ETH',
              name: 'Ether',
              decimals: 18,
              balance: '1284700000000000000',
              priceUsd: '3284.12',
              valueUsd: '4219.11',
              change24hPercent: '1.84',
              isVerified: true,
            },
          ],
        },
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.register(REGISTER)

    expect(user.assets).not.toHaveProperty('totalValueUsd')
    expect(user.assets.tokens).toEqual([
      {
        chainId: '1',
        standard: 'native',
        address: null,
        symbol: 'ETH',
        name: 'Ether',
        decimals: 18,
        balance: '1284700000000000000',
        isVerified: true,
      },
    ])
    expect(user.assets.tokens[0]).not.toHaveProperty('priceUsd')
    expect(user.assets.tokens[0]).not.toHaveProperty('valueUsd')
  })

  it('in development hits the same origin at /v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    await directory.register(REGISTER)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/users')
  })

  it('throws when the directory is unavailable', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })

    await expect(
      directory.register(REGISTER),
    ).rejects.toBeInstanceOf(RemoteAuthError)
  })

  it('throws when the record is rejected', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'invalid_request' } })),
      }) as unknown as typeof fetch,
    })

    await expect(
      directory.register(REGISTER),
    ).rejects.toMatchObject({ name: 'RemoteAuthError', status: 400 })
  })

  it('signs in with email and the_p and returns the record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...USER_BODY,
        balance: '12.5',
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.authenticate({ email: 'james@example.com', theP: 'demo' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users/auth')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      the_p: 'demo',
    })
    expect(user).toEqual({
      id: '7',
      email: 'james@example.com',
      balance: '12.5',
      createdAt: '2026-08-19T12:00:00.000Z',
      wallets: WALLETS,
      assets: EMPTY_REMOTE_ASSETS,
    })
  })

  it('accepts a numeric id from the auth response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...USER_BODY, id: 70 }))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.authenticate({ email: 'theguy@email.com', theP: 'demo' })

    expect(user.id).toBe('70')
  })

  it('reads a fresh record via GET /v1/users/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...USER_BODY,
        assets: {
          quoteCurrency: 'USD',
          updatedAt: '2026-08-22T16:00:00.000Z',
          tokens: [
            {
              chainId: '1',
              standard: 'native',
              address: null,
              symbol: 'ETH',
              name: 'Ether',
              decimals: 18,
              balance: '832117000000000000',
              isVerified: true,
            },
          ],
        },
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.getUser({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8080/v1/users/7?email=james%40example.com&the_p=demo',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
    expect(user.assets.tokens[0]?.balance).toBe('832117000000000000')
  })

  it('reads sendings via GET /v1/users/:id/sendings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        sendings: [
          {
            id: '12',
            createdAt: '2026-08-22T13:00:00.000Z',
            userId: '7',
            status: 'pending',
            failureMessage: null,
            recipientAddress: WALLET.key,
            amount: '0.01',
            symbol: 'ETH',
          },
        ],
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const sendings = await directory.listSendings({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8080/v1/users/7/sendings?email=james%40example.com&the_p=demo',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
    expect(sendings).toEqual([
      {
        id: '12',
        createdAt: '2026-08-22T13:00:00.000Z',
        userId: '7',
        status: 'pending',
        failureMessage: null,
        recipientAddress: WALLET.key,
        amount: '0.01',
        symbol: 'ETH',
      },
    ])
  })

  it('accepts numeric id and amount and skips broken list rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        sendings: [
          {
            id: 12,
            createdAt: '2026-08-22T13:00:00.000Z',
            userId: 7,
            status: 'pending',
            failureMessage: null,
            recipientAddress: WALLET.key,
            amount: 4,
            symbol: 'USDT',
          },
          { id: '', createdAt: 'bad' },
        ],
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const sendings = await directory.listSendings({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    expect(sendings).toEqual([
      {
        id: '12',
        createdAt: '2026-08-22T13:00:00.000Z',
        userId: '7',
        status: 'pending',
        failureMessage: null,
        recipientAddress: WALLET.key,
        amount: '4',
        symbol: 'USDT',
      },
    ])
  })

  it('writes an address via POST /v1/users/wallets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS,
      key: WALLET.key,
      value: WALLET.value,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users/wallets')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      the_p: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS,
      key: WALLET.key,
      value: WALLET.value,
    })
    expect(user.wallets).toEqual(WALLETS)
  })

  it('throws RemoteAuthError when the_p does not match', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'unauthorized' } })),
      }) as unknown as typeof fetch,
    })

    await expect(
      directory.authenticate({ email: 'james@example.com', theP: 'wrong' }),
    ).rejects.toBeInstanceOf(RemoteAuthError)
  })

  it('sends the session user_id in POST /v1/users/sendings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: '12',
        createdAt: '2026-08-22T13:00:00.000Z',
        userId: '70',
        status: 'success',
        failureMessage: null,
        recipientAddress: WALLET.key,
        amount: '0.01',
        symbol: 'ETH',
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const sending = await directory.registerSending({
      userId: '70',
      email: 'theguy@email.com',
      theP: 'demo',
      recipientAddress: WALLET.key,
      amount: '0.01',
      symbol: 'ETH',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users/sendings')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: '70',
      email: 'theguy@email.com',
      the_p: 'demo',
      recipient_address: WALLET.key,
      amount: '0.01',
      symbol: 'ETH',
    })
    expect(sending).toMatchObject({
      userId: '70',
      status: 'success',
      amount: '0.01',
    })
  })
})
