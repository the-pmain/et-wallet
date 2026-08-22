import { describe, expect, it, vi } from 'vitest'

import { NullLogger } from '@/test/doubles'

import { createStartingRemoteAssets, STARTING_REMOTE_TOKENS } from '../lib/starting-assets'
import { EMPTY_REMOTE_ASSETS, INITIAL_WALLET_VALUE, RemoteAuthError, RemoteUserDirectory } from './RemoteUserDirectory'

const WALLET = {
  key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  value: INITIAL_WALLET_VALUE,
}

const ASSETS = createStartingRemoteAssets(new Date('2026-08-20T12:00:00.000Z'))

const USER_BODY = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-19T12:00:00.000Z',
  wallets: [WALLET],
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
  it('шлёт POST на заданный адрес и возвращает созданную запись', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.register({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: WALLET,
      assets: ASSETS,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      balance: '0',
      the_p: 'demo',
      wallets: WALLET,
      assets: ASSETS,
    })
    expect(ASSETS.tokens.every((token) => token.balance === '0')).toBe(true)
    expect(JSON.stringify(ASSETS)).not.toMatch(/priceUsd|valueUsd|totalValueUsd|change24hPercent/u)
    expect(ASSETS.tokens).toEqual(STARTING_REMOTE_TOKENS)
    expect(user).toEqual(USER_BODY)
  })

  it('выбрасывает priceUsd и valueUsd из витрины записи', async () => {
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

    const user = await directory.register({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: WALLET,
      assets: ASSETS,
    })

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

  it('в разработке ходит на тот же origin через /v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    await directory.register({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: WALLET,
      assets: ASSETS,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/users')
  })

  it('бросает, если справочник недоступен', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })

    await expect(
      directory.register({
        email: 'james@example.com',
        balance: '0',
        theP: 'demo',
        wallets: WALLET,
        assets: ASSETS,
      }),
    ).rejects.toBeInstanceOf(RemoteAuthError)
  })

  it('бросает, если запись отвергнута', async () => {
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
      directory.register({
        email: 'james@example.com',
        balance: '0',
        theP: 'demo',
        wallets: WALLET,
        assets: ASSETS,
      }),
    ).rejects.toMatchObject({ name: 'RemoteAuthError', status: 400 })
  })

  it('входит по почте и the_p и возвращает данные записи', async () => {
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
      wallets: [WALLET],
      assets: EMPTY_REMOTE_ASSETS,
    })
  })

  it('принимает id числом из ответа auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...USER_BODY, id: 70 }))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.authenticate({ email: 'theguy@email.com', theP: 'demo' })

    expect(user.id).toBe('70')
  })

  it('читает свежую запись через GET /v1/users/:id', async () => {
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

  it('пишет адрес через POST /v1/users/wallets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      key: WALLET.key,
      value: WALLET.value,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users/wallets')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      the_p: 'demo',
      key: WALLET.key,
      value: WALLET.value,
    })
    expect(user.wallets).toEqual([WALLET])
  })

  it('бросает RemoteAuthError, если the_p не совпала', async () => {
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

  it('шлёт user_id из сессии в POST /v1/users/sendings', async () => {
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
