import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { EMPTY_REMOTE_ASSETS } from '@/features/onboarding/model/RemoteUserDirectory'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

import { ADMIN_PIN_STORAGE_KEY } from '@/features/admin'

const KEY = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const USER = {
  id: '7',
  email: 'james@example.com',
  balance: '12.5',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [{ key: KEY, value: '0' }],
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
  window.location.hash = '#/admin'
  localStorage.clear()
  services = createTestAppServices()

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
      return Promise.resolve(jsonResponse(200, { users: [USER] }))
    }

    if (url.endsWith('/v1/admin/users/7') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, USER))
    }

    if (url.endsWith('/v1/admin/users/7') && method === 'PATCH') {
      const body = requestJson(init) as { wallets?: { value: string }[] }
      const wallets = body.wallets ?? USER.wallets

      return Promise.resolve(jsonResponse(200, { ...USER, wallets }))
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
    const valueField = await screen.findByLabelText(`Value for ${KEY}`)
    await user.clear(valueField)
    await user.type(valueField, '2500')
    await user.click(screen.getByRole('button', { name: 'Save wallets' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(window.location.hash).toContain('/admin/users/7')
  })
})
