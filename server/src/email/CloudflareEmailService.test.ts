import { describe, expect, it, vi } from 'vitest'

import { EmailUnavailableError } from '../lib/errors.ts'

import { CloudflareEmailService } from './CloudflareEmailService.ts'

const MESSAGE = {
  to: 'recipient@example.com',
  from: 'custom123@etwalletx.com',
  subject: 'Welcome!',
  html: '<h1>Hello</h1>',
  text: 'Hello',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CloudflareEmailService', () => {
  it('отказывается без ключей', async () => {
    const service = new CloudflareEmailService({ accountId: null, apiToken: null })

    expect(service.isConfigured).toBe(false)
    await expect(service.send(MESSAGE)).rejects.toBeInstanceOf(EmailUnavailableError)
  })

  it('отправляет письмо на Cloudflare Email Sending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        errors: [],
        result: {
          delivered: ['recipient@example.com'],
          queued: [],
          permanent_bounces: [],
        },
      }),
    )

    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'token',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await service.send(MESSAGE)

    expect(service.isConfigured).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = init.body

    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    })
    expect(typeof body).toBe('string')

    if (typeof body !== 'string') {
      throw new Error('expected a JSON body')
    }

    expect(JSON.parse(body)).toEqual(MESSAGE)
    expect(result.delivered).toEqual(['recipient@example.com'])
  })

  it('отправляет глобальный ключ как X-Auth-Email и X-Auth-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        errors: [],
        result: { delivered: ['recipient@example.com'], queued: [], permanent_bounces: [] },
      }),
    )

    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      authEmail: 'owner@example.com',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await service.send(MESSAGE)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(init.headers).toMatchObject({
      'X-Auth-Email': 'owner@example.com',
      'X-Auth-Key': 'cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      'Content-Type': 'application/json',
    })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('отказывается от глобального ключа без почты входа', async () => {
    const fetchMock = vi.fn()
    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(service.isConfigured).toBe(false)
    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      name: 'EmailUnavailableError',
      message: expect.stringContaining('CLOUDFLARE_EMAIL'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отказывается, если CLOUDFLARE_EMAIL — не почта, а ключ', async () => {
    const fetchMock = vi.fn()
    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      authEmail: 'cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(service.isConfigured).toBe(false)
    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      name: 'EmailUnavailableError',
      message: expect.stringContaining('CLOUDFLARE_EMAIL'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пробрасывает отказ схемы Cloudflare', async () => {
    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'token',
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(400, {
          success: false,
          errors: [{ code: 10001, message: 'email.sending.error.invalid_request_schema' }],
        }),
      ) as unknown as typeof fetch,
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      name: 'EmailSendError',
      statusCode: 400,
      message: 'email.sending.error.invalid_request_schema',
    })
  })

  it('прячет отказ токена за недоступностью отправки', async () => {
    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'bad',
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(401, {
          success: false,
          errors: [{ code: 10101, message: 'email.sending.error.authentication.unauthorized' }],
        }),
      ) as unknown as typeof fetch,
    })

    await expect(service.send(MESSAGE)).rejects.toBeInstanceOf(EmailUnavailableError)
  })
})
