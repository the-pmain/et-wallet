import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { appMarketCatalog, parseMarketList } from '@/core'
import { EMPTY_REMOTE_ASSETS } from '@/features/onboarding/model/RemoteUserDirectory'
import { createTestAppServices, TestEventSource, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

import { ADMIN_PIN_STORAGE_KEY } from '@/features/admin'
import { activityMatchesAdminQuery } from '@/features/admin/model/activity-query'
import { userMatchesAdminQuery } from '@/features/admin/model/admin-query'
import { sendingMatchesAdminQuery } from '@/features/admin/model/sending-query'
import { shortenAddress } from '@/features/wallet'

const RECIPIENT = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

const KEY = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const ETH_TOKEN = {
  chainId: '1',
  standard: 'native' as const,
  address: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  balance: '2000000000000000000',
  isVerified: true,
}

const USDC_TOKEN = {
  chainId: '1',
  standard: 'ERC-20' as const,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  balance: '0',
  isVerified: true,
}

const USER = {
  id: '7',
  email: 'james@example.com',
  balance: '12.5',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [{ key: KEY, value: '0' }],
  assets: {
    quoteCurrency: 'USD' as const,
    updatedAt: '2026-08-20T12:00:00.000Z',
    tokens: [ETH_TOKEN, USDC_TOKEN],
  },
}

const MARIA = {
  id: '8',
  email: 'maria@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [],
  assets: EMPTY_REMOTE_ASSETS,
}

const LEO = {
  id: '74',
  email: 'leo@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [],
  assets: EMPTY_REMOTE_ASSETS,
}

const EMPTY_LOGIN_PLACE = {
  timeZone: null,
  city: null,
  region: null,
  country: null,
  countryCode: null,
}

const LOGIN_ACTIVITY = {
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
        { id: 'e1', createdAt: '2026-09-07T08:12:03.000Z', ...EMPTY_LOGIN_PLACE },
      ],
    },
    {
      userId: '8',
      email: 'maria@example.com',
      loginCount: 0,
      logins: [],
    },
  ],
}

let services: ITestAppServices
let fetchSpy: MockInstance<typeof fetch>
let listedSendings: unknown[]
let listedReceivings: unknown[]

const PENDING_SENDING = {
  id: '61',
  createdAt: '2026-08-22T14:44:10.949Z',
  userId: '74',
  status: 'pending',
  failureMessage: null,
  recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  amount: '2',
  symbol: 'ETH',
} as const

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.href
  }

  return input.url
}

function requestJson(init?: RequestInit): unknown {
  const raw = init?.body

  if (typeof raw !== 'string') {
    return null
  }

  return JSON.parse(raw) as unknown
}

function requestPath(url: string): string {
  try {
    return new URL(url, 'http://admin.local').pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

const DIRECTORY_EMAILS: Readonly<Record<string, string>> = {
  '7': 'james@example.com',
  '8': 'maria@example.com',
  '74': 'leo@example.com',
}

function withUserEmail(record: Record<string, unknown>): Record<string, unknown> {
  const userId = String(record['userId'] ?? '')

  return {
    ...record,
    userEmail: DIRECTORY_EMAILS[userId] ?? null,
  }
}

function directoryPage<T>(
  items: readonly T[],
  url: string,
  matches: (item: T, query: string) => boolean,
): { items: T[]; page: number; pageSize: number; total: number } {
  const parsed = new URL(url, 'http://admin.local')
  const page = Number(parsed.searchParams.get('page') ?? '1')
  const pageSize = Number(parsed.searchParams.get('pageSize') ?? '20')
  const query = parsed.searchParams.get('q') ?? ''
  const filtered = query.trim() === '' ? [...items] : items.filter((item) => matches(item, query))
  const start = (page - 1) * pageSize

  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total: filtered.length,
  }
}

function directorySendingsResponse(url: string, sendings: unknown[]): Response {
  const parsed = new URL(url, 'http://admin.local')
  const status = parsed.searchParams.get('status')
  const source =
    status === 'pending'
      ? sendings.filter((item) => (item as { status?: string }).status === 'pending')
      : sendings

  return jsonResponse(
    200,
    directoryPage(
      source.map((item) => withUserEmail(item as Record<string, unknown>)),
      url,
      (item, query) =>
        sendingMatchesAdminQuery(
          item as unknown as Parameters<typeof sendingMatchesAdminQuery>[0],
          query,
          typeof item['userEmail'] === 'string' ? item['userEmail'] : null,
        ),
    ),
  )
}

function serveDirectoryGet(url: string): Response | null {
  const path = requestPath(url)

  if (path === '/v1/admin/directory/users') {
    return jsonResponse(
      200,
      directoryPage([USER, MARIA, LEO], url, (user, query) =>
        userMatchesAdminQuery(user as never, query),
      ),
    )
  }

  if (path === '/v1/admin/directory/activity') {
    return jsonResponse(
      200,
      directoryPage(LOGIN_ACTIVITY.users, url, (row, query) =>
        activityMatchesAdminQuery(row, query),
      ),
    )
  }

  if (path === '/v1/admin/directory/sendings') {
    return directorySendingsResponse(url, listedSendings)
  }

  if (path === '/v1/admin/directory/receivings') {
    return jsonResponse(
      200,
      directoryPage(
        listedReceivings.map((item) => withUserEmail(item as Record<string, unknown>)),
        url,
        (item, query) =>
          sendingMatchesAdminQuery(
            item as unknown as Parameters<typeof sendingMatchesAdminQuery>[0],
            query,
            typeof item['userEmail'] === 'string' ? item['userEmail'] : null,
          ),
      ),
    )
  }

  return null
}

function renderAdmin() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  openPath('/admin')
  localStorage.clear()
  listedSendings = []
  listedReceivings = []
  services = createTestAppServices()
  appMarketCatalog.hydrate(
    parseMarketList([
      {
        id: 'ethereum',
        symbol: 'eth',
        name: 'Ethereum',
        current_price: 3284.12,
        market_cap_rank: 2,
        total_volume: 1,
        market_cap: 2,
        price_change_percentage_24h_in_currency: 0,
      },
      {
        id: 'usd-coin',
        symbol: 'usdc',
        name: 'USD Coin',
        current_price: 1,
        market_cap_rank: 7,
        total_volume: 1,
        market_cap: 2,
        price_change_percentage_24h_in_currency: 0,
      },
    ]),
  )

  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = requestUrl(input)
    const headers = new Headers(init?.headers)
    const pin = headers.get('x-admin-pin')
    const method = init?.method ?? 'GET'

    if (url.endsWith('/v1/admin/auth')) {
      const body = requestJson(init) as { pin?: string }

      if (body.pin === '9100') {
        return Promise.resolve(jsonResponse(200, { ok: true, role: 'super' }))
      }

      if (body.pin === '4200') {
        return Promise.resolve(jsonResponse(200, { ok: true, role: 'admin' }))
      }

      return Promise.resolve(jsonResponse(401, {}))
    }

    if (pin === '4200') {
      if (method === 'GET') {
        const directory = serveDirectoryGet(url)

        if (directory !== null) {
          return Promise.resolve(directory)
        }
      }

      if (url.endsWith('/v1/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { users: [USER, MARIA, LEO] }))
      }

      if (url.endsWith('/v1/admin/users/7') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, USER))
      }

      if (url.endsWith('/v1/admin/users/7/sendings') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { sendings: [] }))
      }

      if (url.endsWith('/v1/admin/users/7/receivings') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { receivings: [] }))
      }

      if (url.endsWith('/v1/admin/login-events') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, LOGIN_ACTIVITY))
      }

      if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { sendings: listedSendings }))
      }

      if (url.endsWith('/v1/admin/receivings') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { receivings: listedReceivings }))
      }

      if (url.endsWith('/v1/admin/sendings') && method === 'POST') {
        const body = requestJson(init) as Record<string, unknown>

        return Promise.resolve(
          jsonResponse(201, {
            id: 's-admin',
            createdAt: '2026-09-07T12:00:00.000Z',
            userId: '7',
            status: body['status'] ?? 'pending',
            failureMessage: body['failureMessage'] ?? null,
            recipientAddress: body['recipientAddress'] ?? null,
            amount: body['amount'] ?? '0',
            symbol: body['symbol'] ?? 'ETH',
          }),
        )
      }

      if (url.endsWith('/v1/admin/receivings') && method === 'POST') {
        const body = requestJson(init) as Record<string, unknown>

        return Promise.resolve(
          jsonResponse(201, {
            id: 'r-admin',
            createdAt: '2026-09-07T12:00:00.000Z',
            userId: '7',
            status: body['status'] ?? 'pending',
            failureMessage: body['failureMessage'] ?? null,
            recipientAddress: body['recipientAddress'] ?? null,
            amount: body['amount'] ?? '0',
            symbol: body['symbol'] ?? 'ETH',
            usdAmount: body['usdAmount'] ?? null,
          }),
        )
      }

      return Promise.resolve(jsonResponse(403, {}))
    }

    if (pin !== '9100') {
      return Promise.resolve(jsonResponse(401, {}))
    }

    if (method === 'GET') {
      const directory = serveDirectoryGet(url)

      if (directory !== null) {
        return Promise.resolve(directory)
      }
    }

    if (url.endsWith('/v1/admin/users') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { users: [USER, MARIA, LEO] }))
    }

    if (url.endsWith('/v1/admin/login-events') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, LOGIN_ACTIVITY))
    }

    if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { sendings: listedSendings }))
    }

    if (url.endsWith('/v1/admin/users/7/sendings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { sendings: [] }))
    }

    if (url.endsWith('/v1/admin/users/7/receivings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { receivings: [] }))
    }

    if (url.endsWith('/v1/admin/sendings') && method === 'POST') {
      const body = requestJson(init) as Record<string, unknown>

      return Promise.resolve(
        jsonResponse(201, {
          id: 's-1',
          createdAt: '2026-09-07T12:00:00.000Z',
          userId: '7',
          status: body['status'] ?? 'pending',
          failureMessage: body['failureMessage'] ?? null,
          recipientAddress: body['recipientAddress'] ?? null,
          amount: body['amount'] ?? '0',
          symbol: body['symbol'] ?? 'ETH',
        }),
      )
    }

    if (url.endsWith('/v1/admin/receivings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { receivings: listedReceivings }))
    }

    if (url.endsWith('/v1/admin/receivings') && method === 'POST') {
      const body = requestJson(init) as Record<string, unknown>

      return Promise.resolve(
        jsonResponse(201, {
          id: 'r-1',
          createdAt: '2026-09-07T12:00:00.000Z',
          userId: '7',
          status: body['status'] ?? 'pending',
          failureMessage: body['failureMessage'] ?? null,
          recipientAddress: body['recipientAddress'] ?? null,
          amount: body['amount'] ?? '0',
          symbol: body['symbol'] ?? 'ETH',
          usdAmount: body['usdAmount'] ?? null,
        }),
      )
    }

    if (url.includes('/v1/admin/receivings/') && method === 'PATCH') {
      const body = requestJson(init) as Record<string, unknown>
      const id = url.split('/').pop() ?? '0'

      return Promise.resolve(
        jsonResponse(200, {
          id,
          createdAt: '2026-08-22T15:10:00.000Z',
          userId: '7',
          status: body['status'] ?? 'pending',
          failureMessage: body['failureMessage'] ?? null,
          recipientAddress:
            body['recipientAddress'] ?? '0x6B175474E89094C44Da98b954EedeAC495271d0F',
          amount: body['amount'] ?? '12',
          symbol: body['symbol'] ?? 'USDC',
          usdAmount: body['usdAmount'] ?? '12.00',
        }),
      )
    }

    if (url.includes('/v1/admin/sendings/') && method === 'PATCH') {
      const body = requestJson(init) as Record<string, unknown>
      const id = url.split('/').pop() ?? '0'

      return Promise.resolve(
        jsonResponse(200, {
          id,
          createdAt: '2026-08-22T14:59:14.037Z',
          userId: '74',
          status: body['status'] ?? 'pending',
          failureMessage: body['failureMessage'] ?? null,
          recipientAddress:
            body['recipientAddress'] ?? '0x6B175474E89094C44Da98b954EedeAC495271d0F',
          amount: body['amount'] ?? '4',
          symbol: body['symbol'] ?? 'ETH',
        }),
      )
    }

    if (url.endsWith('/v1/admin/users/7') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, USER))
    }

    if (url.endsWith('/v1/admin/users/8') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, MARIA))
    }

    if (url.endsWith('/v1/admin/users/8') && method === 'PATCH') {
      const body = requestJson(init) as { wallets?: unknown }
      const wallets = body.wallets ?? MARIA.wallets

      return Promise.resolve(jsonResponse(200, { ...MARIA, wallets }))
    }

    if (url.endsWith('/v1/admin/users/7') && method === 'PATCH') {
      const body = requestJson(init) as {
        wallets?: { key: string; value: string }[]
        assets?: typeof USER.assets
      }
      const wallets = body.wallets ?? USER.wallets
      const assets = body.assets ?? USER.assets

      return Promise.resolve(jsonResponse(200, { ...USER, wallets, assets }))
    }

    return Promise.resolve(jsonResponse(404, {}))
  })
})

afterEach(() => {
  fetchSpy.mockRestore()
  localStorage.clear()
  window.location.hash = ''
})

describe('Admin cabinet', () => {
  it('asks for a PIN and admits the correct value', async () => {
    const user = userEvent.setup()
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(
      screen.getByText('Enter the PIN to manage users and wallet balances.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'PIN keypad' })).toBeInTheDocument()
    for (const digit of ['9', '1', '0', '0']) {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Super Admin')).toBeInTheDocument()
    expect(await screen.findByText('james@example.com')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Avatar for james@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sendings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument()
    expect(localStorage.getItem(ADMIN_PIN_STORAGE_KEY)).toBe('9100')
  })

  it('does not admit a wrong PIN', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await screen.findByLabelText('PIN')
    await user.type(screen.getByLabelText('PIN'), '0000')

    expect(await screen.findByText('That PIN is not accepted.')).toBeInTheDocument()
    expect(localStorage.getItem(ADMIN_PIN_STORAGE_KEY)).toBeNull()
  })

  it('a read PIN opens the cabinet with Sendings and Receivings, without SSE or writes', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await screen.findByLabelText('PIN')
    for (const digit of ['4', '2', '0', '0']) {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByText('Super Admin')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sendings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Receivings' })).toBeInTheDocument()
    expect(
      TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings')),
    ).toHaveLength(0)

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))
    expect(await screen.findByRole('heading', { name: 'james@example.com' })).toBeInTheDocument()
    expect(screen.queryByLabelText('ETH receiving status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ETH value in USD')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add crypto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create sending' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create receiving' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sending amount')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Receiving amount')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save account' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Wallets' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save wallets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('a read PIN opens the Activity tab and lists authentications', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '4200')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Activity' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('2 users · 2 authentications.')).toBeInTheDocument()
    expect(screen.getByText('Never signed in')).toBeInTheDocument()
    expect(screen.getByText(/id 7 · 2 authentications/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /maria@example.com/i })).toHaveAttribute(
      'href',
      '/admin/users/8',
    )
    expect(screen.getByRole('link', { name: /maria@example.com/i }).className).toMatch(
      /hover:bg-accent/u,
    )
    expect(screen.getByRole('link', { name: /maria@example.com/i }).className).toMatch(
      /text-muted-foreground/u,
    )
    expect(screen.getByText(/id 7 · 2 authentications/).className).toMatch(/text-foreground/u)
    expect(
      fetchSpy.mock.calls.some((call) =>
        requestPath(requestUrl(call[0] as RequestInfo | URL)).endsWith(
          '/v1/admin/directory/activity',
        ),
      ),
    ).toBe(true)

    await user.click(screen.getByText(/id 7 · 2 authentications/))
    expect(document.querySelector('time[datetime="2026-09-08T12:04:21.000Z"]')).not.toBeNull()
    expect(document.querySelector('time[datetime="2026-09-07T08:12:03.000Z"]')).not.toBeNull()
    expect(screen.getAllByText('London, United Kingdom').length).toBeGreaterThan(0)
  })

  it('a read PIN opens Sendings as a view-only list', async () => {
    listedSendings = [
      {
        id: '62',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '74',
        status: 'pending',
        failureMessage: null,
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '4',
        symbol: 'USDC',
      },
    ]

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '4200')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))

    expect(await screen.findByRole('heading', { name: 'Sendings' })).toBeInTheDocument()
    expect((await screen.findAllByText('4 USDC')).length).toBeGreaterThan(0)
    expect(screen.getByText(/USD Coin · Ethereum/)).toBeInTheDocument()
    expect(screen.getByText(`To ${shortenAddress(RECIPIENT)}`)).toBeInTheDocument()
    expect(await screen.findByText('leo@example.com')).toBeInTheDocument()
    expect(screen.getByText('id 62')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument()
    expect(
      TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings')),
    ).toHaveLength(0)
    expect(
      fetchSpy.mock.calls.some((call) =>
        requestPath(requestUrl(call[0] as RequestInfo | URL)).endsWith(
          '/v1/admin/directory/sendings',
        ),
      ),
    ).toBe(true)
  })

  it('a read PIN opens Receivings as a view-only list', async () => {
    listedReceivings = [
      {
        id: '81',
        createdAt: '2026-08-22T15:10:00.000Z',
        userId: '7',
        status: 'success',
        failureMessage: null,
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '2',
        symbol: 'ETH',
        usdAmount: '6568.24',
      },
    ]

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '4200')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Receivings' }))

    expect(await screen.findByRole('heading', { name: 'Receivings' })).toBeInTheDocument()
    expect((await screen.findAllByText('2 ETH')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Ether · Ethereum/)).toBeInTheDocument()
    expect(screen.getByText(`To ${shortenAddress(RECIPIENT)}`)).toBeInTheDocument()
    expect(await screen.findByText('james@example.com')).toBeInTheDocument()
    expect(screen.getByText('id 81')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.some((call) =>
        requestPath(requestUrl(call[0] as RequestInfo | URL)).endsWith(
          '/v1/admin/directory/receivings',
        ),
      ),
    ).toBe(true)
  })

  it('a super PIN also opens the Activity tab', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Activity' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('2 users · 2 authentications.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sendings' })).toBeInTheDocument()
  })

  it('stays in the cabinet with a stored PIN', async () => {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument()
  })

  it('opens a profile and changes a wallet address', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))

    expect(await screen.findByRole('heading', { name: 'james@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Avatar for james@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assets' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Estimated total/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Wallets' }))
    const addressField = await screen.findByLabelText('Address for address-receiving-funds')
    await user.clear(addressField)
    await user.type(addressField, '0x1234567890123456789012345678901234567890')
    await user.click(screen.getByRole('button', { name: 'Save wallets' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(window.location.pathname).toContain('/admin/users/7')
  })

  it('shows a mock wallet by default and adds a named wallet', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /maria@example.com/i }))
    await user.click(await screen.findByRole('button', { name: 'Wallets' }))

    expect(await screen.findByLabelText('Address for mock-wallet')).toHaveValue(
      '0x000000000000000000000000000000000000dEaD',
    )

    await user.type(screen.getByLabelText('Wallet name'), 'Cold')
    await user.type(
      screen.getByLabelText('Wallet address'),
      '0x1234567890123456789012345678901234567890',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByLabelText('Address for cold')).toHaveValue(
      '0x1234567890123456789012345678901234567890',
    )

    await user.click(screen.getByRole('button', { name: 'Save wallets' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()

    const patch = fetchSpy.mock.calls
      .map((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const init = call[1]

        if (!url.endsWith('/v1/admin/users/8') || (init?.method ?? 'GET') !== 'PATCH') {
          return null
        }

        return requestJson(init) as {
          wallets?: Record<string, { key: string; value: string }>
        }
      })
      .find((body) => body !== null)

    expect(patch?.wallets).toMatchObject({
      'mock-wallet': {
        key: '0x000000000000000000000000000000000000dEaD',
      },
      cold: {
        key: '0x1234567890123456789012345678901234567890',
      },
    })
  })

  it('creates a receiving from the asset status select', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))

    const ethUsd = await screen.findByLabelText('ETH value in USD')
    expect(ethUsd).toHaveValue('6568.24')
    expect(await screen.findByText('$6,568.24')).toBeInTheDocument()
    expect(screen.getByText('≈ 2 ETH')).toBeInTheDocument()

    await user.clear(ethUsd)
    await user.type(ethUsd, '9852.36')
    expect(await screen.findByText('$9,852.36')).toBeInTheDocument()
    expect(screen.getByText('≈ 3 ETH')).toBeInTheDocument()

    await user.click(screen.getByLabelText('ETH receiving status'))
    await user.click(screen.getByRole('option', { name: 'success' }))
    expect(await screen.findByText('Receiving created (success).')).toBeInTheDocument()

    const usdcUsd = screen.getByLabelText('USDC value in USD')
    await user.clear(usdcUsd)
    await user.type(usdcUsd, '1.5')
    expect(screen.getByText('≈ 1.5 USDC')).toBeInTheDocument()
    await user.click(screen.getByLabelText('USDC receiving status'))
    await user.click(screen.getByRole('option', { name: 'pending' }))
    expect(await screen.findByText('Receiving created (pending).')).toBeInTheDocument()

    const created = fetchSpy.mock.calls
      .map((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const init = call[1]
        const method = init?.method ?? 'GET'

        if (!url.endsWith('/v1/admin/receivings') || method !== 'POST') {
          return null
        }

        return requestJson(init) as {
          symbol?: string
          amount?: string
          status?: string
          usdAmount?: string
        }
      })
      .filter((body) => body !== null)

    expect(created[0]).toMatchObject({
      symbol: 'ETH',
      amount: '3',
      status: 'success',
      usdAmount: '9852.36',
    })
    expect(created[1]).toMatchObject({
      symbol: 'USDC',
      amount: '1.5',
      status: 'pending',
      usdAmount: '1.5',
    })
  })

  it('creates a sending and a receiving from the user Assets sections', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))
    await screen.findByLabelText('Sending amount')

    await user.type(screen.getByLabelText('Sending amount'), '0.01')
    await user.type(
      screen.getByLabelText('Recipient'),
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    )
    await user.click(screen.getByRole('button', { name: 'Create sending' }))

    expect(await screen.findByText('Sending created (pending).')).toBeInTheDocument()
    expect(screen.queryByText('No sendings yet')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Receiving amount'), '0.15')
    expect(await screen.findByText('≈ $492.62')).toBeInTheDocument()
    expect(screen.queryByLabelText('USD (optional)')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Receiving amount'))
    await user.click(screen.getByLabelText('Receiving asset'))
    await user.click(screen.getByRole('option', { name: 'Select USDT on Ethereum' }))
    await user.type(screen.getByLabelText('Receiving amount'), '0.2')
    await user.click(screen.getByRole('button', { name: 'Create receiving' }))

    expect(await screen.findByText('Receiving created (pending).')).toBeInTheDocument()
    expect(screen.queryByText('No receivings yet')).not.toBeInTheDocument()

    const posts = fetchSpy.mock.calls
      .map((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const init = call[1]
        const method = init?.method ?? 'GET'

        if (method !== 'POST') {
          return null
        }

        if (url.endsWith('/v1/admin/sendings')) {
          return { kind: 'sending', body: requestJson(init) }
        }

        if (url.endsWith('/v1/admin/receivings')) {
          return { kind: 'receiving', body: requestJson(init) }
        }

        return null
      })
      .filter((item) => item !== null)

    expect(posts).toEqual(
      expect.arrayContaining([
        {
          kind: 'sending',
          body: expect.objectContaining({
            userId: '7',
            amount: '0.01',
            symbol: 'ETH',
            recipientAddress: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
            status: 'pending',
          }),
        },
        {
          kind: 'receiving',
          body: expect.objectContaining({
            userId: '7',
            amount: '0.2',
            symbol: 'USDT',
            status: 'pending',
          }),
        },
      ]),
    )
  })

  it('adds a cryptocurrency from the Assets header menu', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))
    await screen.findByLabelText('ETH value in USD')

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))
    const usdt = await screen.findByRole('menuitem', { name: 'Add USDT on Ethereum' })
    expect(usdt.querySelector('img')?.getAttribute('src')).toBe('/logos/usdt.svg')

    await user.click(usdt)
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('USDT value in USD')).toHaveValue('0')

    const patch = fetchSpy.mock.calls
      .map((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const init = call[1]
        const method = init?.method ?? 'GET'

        if (!url.endsWith('/v1/admin/users/7') || method !== 'PATCH') {
          return null
        }

        return requestJson(init) as {
          assets?: { tokens?: { symbol: string; chainId: string; balance: string }[] }
        }
      })
      .find((body) => body?.assets?.tokens?.some((token) => token.symbol === 'USDT'))

    expect(patch?.assets?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'USDT',
          chainId: '1',
          balance: '0',
        }),
      ]),
    )
  })

  it('finds a user by wallet address', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByText('james@example.com')).toBeInTheDocument()
    expect(screen.getByText('maria@example.com')).toBeInTheDocument()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search email or Wallet address' }),
      '5aaeb605',
    )

    expect(screen.getByRole('status')).toHaveTextContent('Searching users')

    await waitFor(() => {
      expect(screen.getByText('james@example.com')).toBeInTheDocument()
      expect(screen.queryByText('maria@example.com')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens the Sendings tab, the SSE stream, and appends a create frame', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sendings' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Sendings' }))

    expect(await screen.findByRole('heading', { name: 'Sendings' })).toBeInTheDocument()
    expect(screen.getByText('No sendings yet')).toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.some((call) =>
        requestPath(requestUrl(call[0] as RequestInfo | URL)).endsWith(
          '/v1/admin/directory/sendings',
        ),
      ),
    ).toBe(true)

    const sources = TestEventSource.instances.filter((source) =>
      source.url.includes('/v1/sendings'),
    )
    expect(sources).toHaveLength(1)
    expect(sources[0]?.url).toBe('/v1/sendings')
    expect(sources[0]?.closed).toBe(false)

    sources[0]?.emit(
      'sendings',
      JSON.stringify({
        id: '61',
        createdAt: '2026-08-22T14:44:10.949Z',
        userId: '74',
        status: 'pending',
        failureMessage: null,
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '2',
        symbol: 'ETH',
        userEmail: 'leo@example.com',
        type_send: 'create',
      }),
    )

    expect((await screen.findAllByText('2 ETH')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Ether · Ethereum/)).toBeInTheDocument()
    expect(screen.getByText(`To ${shortenAddress(RECIPIENT)}`)).toBeInTheDocument()
    expect(await screen.findByText('leo@example.com')).toBeInTheDocument()
    expect(screen.getByText('id 61')).toBeInTheDocument()
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0)
    expect(screen.getByText('1 record in the directory.')).toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-08-22T14:44:10.949Z"]')).not.toBeNull()
  })

  it('colors pending, success, and failure statuses', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))
    await screen.findByRole('heading', { name: 'Sendings' })

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source).toBeDefined()

    const frames = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'success' },
      { id: '3', status: 'failure' },
    ] as const

    for (const frame of frames) {
      source?.emit(
        'sendings',
        JSON.stringify({
          id: frame.id,
          createdAt: '2026-08-22T14:44:10.949Z',
          userId: '74',
          status: frame.status,
          failureMessage: frame.status === 'failure' ? 'rejected' : null,
          recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
          amount: '1',
          symbol: 'ETH',
          type_send: 'create',
        }),
      )
    }

    const pending = (await screen.findAllByText('pending'))[0]
    const success = screen.getByText('success')
    const failure = screen.getByText('failure')

    expect(pending?.className).toMatch(/risk-medium|warning/u)
    expect(success.className).toMatch(/risk-low/u)
    expect(failure.className).toMatch(/destructive/u)
    expect(screen.getByText(/rejected/)).toBeInTheDocument()
  })

  it('opens sendings with one directory GET and no dump endpoints', async () => {
    openPath('/admin/sendings')
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Sendings' })).toBeInTheDocument()

    const getPaths = fetchSpy.mock.calls
      .filter((call) => (call[1]?.method ?? 'GET') === 'GET')
      .map((call) => requestPath(requestUrl(call[0] as RequestInfo | URL)))

    expect(getPaths.filter((path) => path === '/v1/admin/directory/sendings')).toHaveLength(1)
    expect(getPaths.includes('/v1/admin/sendings')).toBe(false)
    expect(getPaths.includes('/v1/admin/users')).toBe(false)
  })

  it('opens receivings without requesting sendings', async () => {
    openPath('/admin/receivings')
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Receivings' })).toBeInTheDocument()

    await waitFor(() => {
      const getPaths = fetchSpy.mock.calls
        .filter((call) => (call[1]?.method ?? 'GET') === 'GET')
        .map((call) => requestPath(requestUrl(call[0] as RequestInfo | URL)))

      expect(getPaths.filter((path) => path === '/v1/admin/directory/receivings')).toHaveLength(1)
    })

    const getPaths = fetchSpy.mock.calls
      .filter((call) => (call[1]?.method ?? 'GET') === 'GET')
      .map((call) => requestPath(requestUrl(call[0] as RequestInfo | URL)))

    expect(getPaths.includes('/v1/admin/directory/sendings')).toBe(false)
    expect(getPaths.includes('/v1/admin/sendings')).toBe(false)
    expect(getPaths.includes('/v1/admin/receivings')).toBe(false)
  })

  it('renders records from GET /v1/admin/directory/sendings', async () => {
    const previous = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (requestPath(url) === '/v1/admin/directory/sendings' && method === 'GET') {
        return Promise.resolve(
          directorySendingsResponse(url, [
            {
              id: '62',
              createdAt: '2026-08-22T14:59:14.037Z',
              userId: '74',
              status: 'pending',
              failureMessage: null,
              recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
              amount: '4',
              symbol: 'USDC',
            },
          ]),
        )
      }

      return previous?.(input, init) ?? Promise.resolve(jsonResponse(404, {}))
    })

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))

    expect((await screen.findAllByText('4 USDC')).length).toBeGreaterThan(0)
    expect(screen.getByText(/USD Coin · Ethereum/)).toBeInTheDocument()
    expect(screen.getByText(`To ${shortenAddress(RECIPIENT)}`)).toBeInTheDocument()
    expect(await screen.findByText('leo@example.com')).toBeInTheDocument()
    expect(screen.getByText('id 62')).toBeInTheDocument()
  })

  it('saves a sending edit via PATCH and sends status with failureMessage', async () => {
    const previous = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (requestPath(url) === '/v1/admin/directory/sendings' && method === 'GET') {
        return Promise.resolve(
          directorySendingsResponse(url, [
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
          ]),
        )
      }

      return previous?.(input, init) ?? Promise.resolve(jsonResponse(404, {}))
    })

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))
    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))

    expect(await screen.findByRole('heading', { name: 'Edit sending' })).toBeInTheDocument()
    expect(screen.getAllByText('leo@example.com').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Failure reason')).toBeDisabled()
    expect(screen.getByLabelText('Failure reason').className).not.toMatch(/text-destructive/u)
    expect(screen.getByText('Failure reason')).not.toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByLabelText('Asset')).toHaveTextContent('ETH')
    await user.click(screen.getByLabelText('Asset'))
    expect(screen.getByRole('option', { name: 'ETH' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'USDC' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'USDT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DAI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WBTC' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WETH' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('Status'))
    await user.click(screen.getByRole('option', { name: 'failure' }))
    expect(screen.getByLabelText('Status').className).toMatch(/text-destructive/u)
    expect(screen.getByText('Status')).toHaveClass('text-destructive')
    expect(screen.getByLabelText('Failure reason')).toBeEnabled()
    expect(screen.getByLabelText('Failure reason').className).toMatch(/text-destructive/u)
    expect(screen.getByText('Failure reason')).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByLabelText('Failure reason'))
    expect(screen.getByRole('option', { name: 'Insufficient balance' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Custom…' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Blocked by admin' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const method = call[1]?.method ?? 'GET'

        return url.endsWith('/v1/admin/sendings/62') && method === 'PATCH'
      })

      expect(patch).toBeDefined()
      expect(requestJson(patch?.[1])).toMatchObject({
        status: 'failure',
        failureMessage: 'Blocked by admin',
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '4',
        symbol: 'ETH',
      })
    })
  })

  it('lets the admin write a custom rejection reason via Custom', async () => {
    const previous = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (requestPath(url) === '/v1/admin/directory/sendings' && method === 'GET') {
        return Promise.resolve(
          directorySendingsResponse(url, [
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
          ]),
        )
      }

      return previous?.(input, init) ?? Promise.resolve(jsonResponse(404, {}))
    })

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))
    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))
    await screen.findByRole('heading', { name: 'Edit sending' })

    await user.click(screen.getByLabelText('Status'))
    await user.click(screen.getByRole('option', { name: 'failure' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByLabelText('Failure reason'))
    await user.click(screen.getByRole('option', { name: 'Custom…' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Custom failure message'), 'Node timed out')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const method = call[1]?.method ?? 'GET'

        return url.endsWith('/v1/admin/sendings/62') && method === 'PATCH'
      })

      expect(requestJson(patch?.[1])).toMatchObject({
        status: 'failure',
        failureMessage: 'Node timed out',
      })
    })
  })

  it('lets the admin write a custom receiving failure reason', async () => {
    listedReceivings = [
      {
        id: '81',
        createdAt: '2026-08-22T15:10:00.000Z',
        userId: '7',
        status: 'failure',
        failureMessage: 'Chargeback opened on this deposit',
        recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        amount: '12',
        symbol: 'USDC',
        usdAmount: '12.00',
      },
    ]

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Receivings' }))
    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))
    await screen.findByRole('heading', { name: 'Edit receiving' })

    expect(screen.getByLabelText('Failure reason')).toHaveTextContent('Custom…')
    const custom = screen.getByLabelText('Custom failure message')
    expect(custom).toHaveValue('Chargeback opened on this deposit')
    await user.clear(custom)
    await user.type(custom, 'Bank reversed the wire')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const method = call[1]?.method ?? 'GET'

        return url.endsWith('/v1/admin/receivings/81') && method === 'PATCH'
      })

      expect(requestJson(patch?.[1])).toMatchObject({
        status: 'failure',
        failureMessage: 'Bank reversed the wire',
      })
    })
  })

  it('shows a toast for a new pending send on any cabinet tab', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()

    await waitFor(() => {
      expect(TestEventSource.instances.some((item) => item.url.includes('/v1/sendings'))).toBe(true)
    })

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source?.url).toBe('/v1/sendings')

    source?.emit(
      'sendings',
      JSON.stringify({
        ...PENDING_SENDING,
        userEmail: 'leo@example.com',
        type_send: 'create',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Pending sending added')
    expect(screen.getByRole('alert')).toHaveTextContent('2 ETH')
    expect(await screen.findByText(/User leo@example.com/)).toBeInTheDocument()
    const handle = screen.getByRole('button', { name: 'Handle pending sending 2 ETH' })
    expect(handle).toBeInTheDocument()
    expect(handle.className).toMatch(/h-16/u)

    await user.click(handle)

    expect(await screen.findByRole('heading', { name: 'Edit sending' })).toBeInTheDocument()
  })

  it('immediately shows pending sends already in the directory', async () => {
    listedSendings = [PENDING_SENDING]
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Pending sending added')
    expect(screen.getByRole('alert')).toHaveTextContent('2 ETH')
    expect(screen.getByRole('button', { name: 'Handle pending sending 2 ETH' })).toBeInTheDocument()
  })

  it('collapses a queue longer than three cards into a list link', async () => {
    listedSendings = [1, 2, 3, 4].map((index) => ({
      ...PENDING_SENDING,
      id: String(60 + index),
      createdAt: `2026-08-22T14:4${String(index)}:10.949Z`,
      amount: String(index),
    }))
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(await screen.findAllByRole('alert')).toHaveLength(3)
    expect(screen.getByRole('link', { name: '1 more pending sending' })).toHaveAttribute(
      'href',
      '/admin/sendings',
    )
  })

  it('does not toast a send that is not pending from the start', async () => {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await screen.findByRole('heading', { name: 'Users' })

    await waitFor(() => {
      expect(TestEventSource.instances.some((item) => item.url.includes('/v1/sendings'))).toBe(true)
    })

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    source?.emit(
      'sendings',
      JSON.stringify({
        ...PENDING_SENDING,
        id: '80',
        status: 'success',
        amount: '1',
        type_send: 'create',
      }),
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a pending-send toast can be dismissed without opening the edit', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await screen.findByRole('heading', { name: 'Users' })

    await waitFor(() => {
      expect(TestEventSource.instances.some((item) => item.url.includes('/v1/sendings'))).toBe(true)
    })

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    source?.emit('sendings', JSON.stringify({ ...PENDING_SENDING, type_send: 'create' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss pending sending' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
