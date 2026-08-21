import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

import { EMAIL_MANAGER_PIN_STORAGE_KEY } from '@/features/email-manager'

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

function renderEmailManager() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  openPath('/email-manager')
  localStorage.clear()
  services = createTestAppServices()

  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = requestUrl(input)
    const headers = new Headers(init?.headers)
    const pin = headers.get('x-email-manager-pin')
    const method = init?.method ?? 'GET'

    if (url.endsWith('/v1/email-manager/auth')) {
      const body = requestJson(init) as { pin?: string }
      const accepted = body.pin === '3100'

      return Promise.resolve(jsonResponse(accepted ? 200 : 401, accepted ? { ok: true } : {}))
    }

    if (pin !== '3100') {
      return Promise.resolve(jsonResponse(401, {}))
    }

    if (url.endsWith('/v1/admin/email') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { configured: true }))
    }

    if (url.endsWith('/v1/admin/email/send') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(200, {
          delivered: ['support@etwalletx.com'],
          queued: [],
          permanentBounces: [],
        }),
      )
    }

    return Promise.resolve(jsonResponse(404, {}))
  })
})

afterEach(() => {
  fetchSpy.mockRestore()
  localStorage.clear()
  window.location.hash = ''
})

describe('Менеджер писем', () => {
  it('спрашивает PIN и пускает при верном значении', async () => {
    const user = userEvent.setup()
    renderEmailManager()

    expect(await screen.findByRole('heading', { name: 'Email manager' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('PIN'), '3100')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByTitle('Preview')).toBeInTheDocument()
    expect(localStorage.getItem(EMAIL_MANAGER_PIN_STORAGE_KEY)).toBe('3100')
    expect(localStorage.getItem('etwallet.admin-pin')).toBeNull()
  })

  it('не пускает с неверным PIN', async () => {
    const user = userEvent.setup()
    renderEmailManager()

    await screen.findByLabelText('PIN')
    await user.type(screen.getByLabelText('PIN'), '9100')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not accepted.')).toBeInTheDocument()
    expect(localStorage.getItem(EMAIL_MANAGER_PIN_STORAGE_KEY)).toBeNull()
  })

  it('показывает макет и отправляет с зашитого адреса', async () => {
    const user = userEvent.setup()
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, '3100')
    renderEmailManager()

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByTitle('Preview')).toHaveAttribute('src', expect.stringMatching(/^blob:/u))

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Sent to support@etwalletx.com.')).toBeInTheDocument()

    const send = fetchSpy.mock.calls.find((call) => {
      const url = requestUrl(call[0] as RequestInfo | URL)
      const method = call[1]?.method ?? 'GET'

      return url.endsWith('/v1/admin/email/send') && method === 'POST'
    })

    expect(new Headers(send?.[1]?.headers).get('x-email-manager-pin')).toBe('3100')
    expect(requestJson(send?.[1])).toMatchObject({
      to: 'support@etwalletx.com',
      from: 'support@etwalletx.com',
      subject: 'ETWallet',
    })
  })
})
