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
      const accepted = body.pin === '9100'

      return Promise.resolve(jsonResponse(accepted ? 200 : 401, accepted ? { ok: true } : {}))
    }

    if (pin !== '9100') {
      return Promise.resolve(jsonResponse(401, {}))
    }

    if (url.endsWith('/v1/admin/users') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { users: [USER, MARIA] }))
    }

    if (url.endsWith('/v1/admin/sendings') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { sendings: [] }))
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
          recipientAddress: body['recipientAddress'] ?? '0x6B175474E89094C44Da98b954EedeAC495271d0F',
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

describe('Кабинет администратора', () => {
  it('спрашивает PIN и пускает при верном значении', async () => {
    const user = userEvent.setup()
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('PIN'), '9100')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(await screen.findByText('james@example.com')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Avatar for james@example.com' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument()
    expect(localStorage.getItem(ADMIN_PIN_STORAGE_KEY)).toBe('9100')
  })

  it('не пускает с неверным PIN', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await screen.findByLabelText('PIN')
    await user.type(screen.getByLabelText('PIN'), '0000')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not accepted.')).toBeInTheDocument()
    expect(localStorage.getItem(ADMIN_PIN_STORAGE_KEY)).toBeNull()
  })

  it('остаётся в кабинете по сохранённому PIN', async () => {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument()
  })

  it('открывает профиль и меняет значение кошелька', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    await user.click(await screen.findByRole('link', { name: /james@example.com/i }))

    expect(await screen.findByRole('heading', { name: 'james@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Avatar for james@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assets' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Estimated total/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Wallets' }))
    const valueField = await screen.findByLabelText(`Value for ${KEY}`)
    await user.clear(valueField)
    await user.type(valueField, '2500')
    await user.click(screen.getByRole('button', { name: 'Save wallets' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(window.location.pathname).toContain('/admin/users/7')
  })

  it('сохраняет сумму актива в минимальных единицах с кнопки строки', async () => {
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

  it('добавляет криптовалюту из меню в шапке Assets', async () => {
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

  it('ищет пользователя по адресу кошелька', async () => {
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

  it('открывает вкладку Sendings, поток SSE и добавляет кадр create', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '9100')
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sendings' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Sendings' }))

    expect(await screen.findByRole('heading', { name: 'Sendings' })).toBeInTheDocument()
    expect(screen.getByText('No sendings yet')).toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).endsWith('/v1/admin/sendings')),
    ).toBe(true)

    const sources = TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings'))
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

    expect(await screen.findByText('ETH')).toBeInTheDocument()
    expect(screen.getByText('Ether · Ethereum')).toBeInTheDocument()
    expect(screen.getByText('0x6B175474E89094C44Da98b954EedeAC495271d0F')).toBeInTheDocument()
    expect(screen.getByText(/id 61 · user 74/)).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('1 record in the directory.')).toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-08-22T14:44:10.949Z"]')).not.toBeNull()
  })

  it('окрашивает статусы pending, success и failure', async () => {
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

    const pending = await screen.findByText('pending')
    const success = screen.getByText('success')
    const failure = screen.getByText('failure')

    expect(pending.className).toMatch(/risk-medium|warning/u)
    expect(success.className).toMatch(/risk-low/u)
    expect(failure.className).toMatch(/destructive/u)
    expect(screen.getByText(/rejected/)).toBeInTheDocument()
  })

  it('рисует записи из GET /v1/admin/sendings', async () => {
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

    expect(await screen.findByText('USDC')).toBeInTheDocument()
    expect(screen.getByText(/USD Coin · Ethereum/)).toBeInTheDocument()
    expect(screen.getByText('0x6B175474E89094C44Da98b954EedeAC495271d0F')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/id 62 · user 74/)).toBeInTheDocument()
  })

  it('сохраняет правку sending через PATCH и шлёт status с failureMessage', async () => {
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
    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(await screen.findByRole('heading', { name: 'Edit sending' })).toBeInTheDocument()
    const symbolField = screen.getByLabelText('symbol')
    expect(symbolField).toHaveValue('ETH')
    expect(symbolField).toHaveDisplayValue('ETH')
    expect(screen.getByRole('option', { name: 'USDC' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'USDT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DAI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WBTC' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WETH' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('status'), 'failure')
    await user.type(screen.getByLabelText('failureMessage'), 'Blocked by admin')
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
})
