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
let storedMessages: Array<Record<string, unknown>>

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

function mailboxListCalls(): readonly unknown[] {
  return fetchSpy.mock.calls.filter((call) => {
    const parsed = new URL(requestUrl(call[0] as RequestInfo | URL), 'http://local.test')
    const method = call[1]?.method ?? 'GET'

    return parsed.pathname.endsWith('/v1/email-manager/messages') && method === 'GET'
  })
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
  storedMessages = [
    {
      id: '1',
      createdAt: '2026-08-21T12:00:00.000Z',
      direction: 'received',
      from: 'user@example.com',
      to: 'support@etwalletx.com',
      subject: 'Need help',
      html: null,
      text: 'Please help',
      status: 'received',
    },
  ]

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
      return Promise.resolve(
        jsonResponse(200, {
          configured: true,
          storageWarning: null,
          defaultFrom: 'support@etwalletx.com',
          sendingDomain: 'etwalletx.com',
          fromAddresses: [
            'support@etwalletx.com',
            'hello@etwalletx.com',
            'info@etwalletx.com',
            'contact@etwalletx.com',
            'team@etwalletx.com',
            'mail@etwalletx.com',
            'enquiries@etwalletx.com',
          ],
        }),
      )
    }

    if (new URL(url, 'http://local.test').pathname.endsWith('/v1/email-manager/messages') && method === 'GET') {
      const parsed = new URL(url, 'http://local.test')
      const peer = parsed.searchParams.get('peer')
      const cursor = parsed.searchParams.get('cursor')
      let rows = storedMessages

      if (peer !== null) {
        const needle = peer.toLowerCase()
        rows = rows.filter((message) => {
          const from = String(message['from'] ?? '').toLowerCase()
          const to = String(message['to'] ?? '').toLowerCase()

          return from === needle || to === needle
        })
      }

      if (peer === null && rows.length > 1 && cursor === null) {
        return Promise.resolve(
          jsonResponse(200, { messages: rows.slice(0, 1), nextCursor: 'c1' }),
        )
      }

      if (cursor === 'c1') {
        rows = rows.slice(1)
      }

      return Promise.resolve(jsonResponse(200, { messages: rows, nextCursor: null }))
    }

    if (url.endsWith('/v1/admin/email/recipients') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { recipients: ['maria@example.com'] }))
    }

    if (url.endsWith('/v1/admin/email/send') && method === 'POST') {
      const body = requestJson(init) as { to?: string; from?: string; subject?: string; text?: string }

      storedMessages = [
        {
          id: '2',
          createdAt: '2026-08-21T13:00:00.000Z',
          direction: 'sent',
          from: body.from ?? 'support@etwalletx.com',
          to: body.to ?? 'maria@example.com',
          subject: body.subject ?? 'ETWallet',
          html: null,
          text: body.text ?? 'Sent',
          status: 'delivered',
        },
        ...storedMessages,
      ]

      return Promise.resolve(
        jsonResponse(200, {
          delivered: [body.to ?? 'maria@example.com'],
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

    expect(await screen.findByRole('heading', { name: 'Conversations' })).toBeInTheDocument()
    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New conversation/i })).toBeInTheDocument()
    expect(localStorage.getItem(EMAIL_MANAGER_PIN_STORAGE_KEY)).toBe('3100')
    expect(mailboxListCalls().length).toBeGreaterThan(0)
  })

  it('не пускает с неверным PIN', async () => {
    const user = userEvent.setup()
    renderEmailManager()

    await screen.findByLabelText('PIN')
    await user.type(screen.getByLabelText('PIN'), '9100')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not accepted.')).toBeInTheDocument()
  })

  it('отправляет с выбранных From и To', async () => {
    const user = userEvent.setup()
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, '3100')
    renderEmailManager()

    await screen.findByRole('heading', { name: 'Conversations' })
    await user.click(screen.getByRole('link', { name: /New conversation/i }))

    await screen.findByLabelText('From')
    await user.click(screen.getByLabelText('From'))
    await user.click(screen.getByRole('option', { name: 'hello@etwalletx.com' }))
    await user.type(screen.getByLabelText('To'), 'maria@example.com')
    await user.click(screen.getByRole('button', { name: /^Send$/i }))

    expect(await screen.findByRole('heading', { name: 'maria@example.com' })).toBeInTheDocument()

    const send = fetchSpy.mock.calls.find((call) => {
      const url = requestUrl(call[0] as RequestInfo | URL)
      const method = call[1]?.method ?? 'GET'

      return url.endsWith('/v1/admin/email/send') && method === 'POST'
    })

    expect(requestJson(send?.[1])).toMatchObject({
      to: 'maria@example.com',
      from: 'hello@etwalletx.com',
    })
  })

  it('открывает переписку всеми письмами из GET /v1/email-manager/messages', async () => {
    storedMessages = [
      {
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'received',
        from: 'user@example.com',
        to: 'support@etwalletx.com',
        subject: 'Need help',
        html: null,
        text: 'Please help',
        status: 'received',
      },
      {
        id: '2',
        createdAt: '2026-08-21T13:00:00.000Z',
        direction: 'sent',
        from: 'support@etwalletx.com',
        to: 'user@example.com',
        subject: 'Re: Need help',
        html: null,
        text: 'On the way',
        status: 'delivered',
      },
    ]

    const user = userEvent.setup()
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, '3100')
    renderEmailManager()

    await screen.findByRole('heading', { name: 'Conversations' })
    expect(mailboxListCalls().length).toBeGreaterThan(0)

    await user.click(screen.getByRole('link', { name: /user@example.com/i }))

    expect(await screen.findByRole('heading', { name: 'user@example.com' })).toBeInTheDocument()
    expect(screen.getByText('Need help')).toBeInTheDocument()
    expect(screen.getByText('Please help')).toBeInTheDocument()
    expect(screen.getByText('Re: Need help')).toBeInTheDocument()
    expect(screen.getByText('On the way')).toBeInTheDocument()
    expect(mailboxListCalls().length).toBeGreaterThan(1)
  })

  it('листает разговоры через GET /v1/email-manager/messages', async () => {
    storedMessages = [
      {
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'received',
        from: 'user@example.com',
        to: 'support@etwalletx.com',
        subject: 'Need help',
        html: null,
        text: 'Please help',
        status: 'received',
      },
      {
        id: '3',
        createdAt: '2026-08-21T11:00:00.000Z',
        direction: 'received',
        from: 'maria@example.com',
        to: 'support@etwalletx.com',
        subject: 'Hello',
        html: null,
        text: 'Hi',
        status: 'received',
      },
    ]

    const user = userEvent.setup()
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, '3100')
    renderEmailManager()

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.queryByText('maria@example.com')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('maria@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })
})
