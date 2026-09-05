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

let services: ITestAppServices
let fetchSpy: MockInstance<typeof fetch>
let listedSendings: unknown[]

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
      if (url.endsWith('/v1/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { users: [USER, MARIA] }))
      }

      if (url.endsWith('/v1/admin/users/7') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, USER))
      }

      return Promise.resolve(jsonResponse(403, {}))
    }

    if (pin !== '9100') {
      return Promise.resolve(jsonResponse(401, {}))
    }

    if (url.endsWith('/v1/admin/users') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { users: [USER, MARIA] }))
    }

    if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { sendings: listedSendings }))
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

  it('a read PIN opens the cabinet without Sendings, SSE, or writes', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await screen.findByLabelText('PIN')
    for (const digit of ['4', '2', '0', '0']) {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByText('Super Admin')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sendings' })).not.toBeInTheDocument()
    expect(
      TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings')),
    ).toHaveLength(0)

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))
    expect(await screen.findByRole('heading', { name: 'james@example.com' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save ETH' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add crypto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()
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

  it('saves an asset amount in minimal units from the row button', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Save ETH' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()

    const usdcUsd = screen.getByLabelText('USDC value in USD')
    await user.clear(usdcUsd)
    await user.type(usdcUsd, '1.5')
    expect(screen.getByText('≈ 1.5 USDC')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save USDC' }))
    expect(await screen.findAllByText('Saved.')).not.toHaveLength(0)

    const patches = fetchSpy.mock.calls
      .map((call) => {
        const url = requestUrl(call[0] as RequestInfo | URL)
        const init = call[1]
        const method = init?.method ?? 'GET'

        if (!url.endsWith('/v1/admin/users/7') || method !== 'PATCH') {
          return null
        }

        return requestJson(init) as {
          assets?: { tokens?: { symbol: string; balance: string }[] }
        }
      })
      .filter((body) => body !== null)

    expect(patches[0]?.assets?.tokens?.[0]).toMatchObject({
      symbol: 'ETH',
      balance: '3000000000000000000',
    })
    expect(patches[1]?.assets?.tokens?.[1]).toMatchObject({
      symbol: 'USDC',
      balance: '1500000',
    })
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

    expect(screen.getByText('james@example.com')).toBeInTheDocument()
    expect(screen.queryByText('maria@example.com')).not.toBeInTheDocument()
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
        requestUrl(call[0] as RequestInfo | URL).endsWith('/v1/admin/sendings'),
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
        type_send: 'create',
      }),
    )

    expect((await screen.findAllByText('2 ETH')).length).toBeGreaterThan(0)
    expect(screen.getByText('Ether · Ethereum')).toBeInTheDocument()
    expect(screen.getByText('0x6B175474E89094C44Da98b954EedeAC495271d0F')).toBeInTheDocument()
    expect(screen.getByText(/id 61 · user 74/)).toBeInTheDocument()
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

  it('renders records from GET /v1/admin/sendings', async () => {
    const previous = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
        return Promise.resolve(
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
                symbol: 'USDC',
              },
            ],
          }),
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
    expect(screen.getByText('0x6B175474E89094C44Da98b954EedeAC495271d0F')).toBeInTheDocument()
    expect(screen.getByText(/id 62 · user 74/)).toBeInTheDocument()
  })

  it('saves a sending edit via PATCH and sends status with failureMessage', async () => {
    const previous = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
        return Promise.resolve(
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
      }

      return previous?.(input, init) ?? Promise.resolve(jsonResponse(404, {}))
    })

    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: 'Sendings' }))
    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))

    expect(await screen.findByRole('heading', { name: 'Edit sending' })).toBeInTheDocument()
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

      if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
        return Promise.resolve(
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

    source?.emit('sendings', JSON.stringify({ ...PENDING_SENDING, type_send: 'create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pending sending added')
    expect(screen.getByRole('alert')).toHaveTextContent('2 ETH')
    expect(screen.getByRole('alert')).toHaveTextContent('User 74')
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
