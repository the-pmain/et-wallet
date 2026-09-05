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
  it('refuses without keys', async () => {
    const service = new CloudflareEmailService({ accountId: null, apiToken: null })

    expect(service.isConfigured).toBe(false)
    await expect(service.send(MESSAGE)).rejects.toBeInstanceOf(EmailUnavailableError)
  })

  it('sends mail through Cloudflare Email Sending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        errors: [],
        result: {
          message_id: 'msg-1',
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
    expect(result.messageId).toBe('msg-1')
  })

  it('sends a global key as X-Auth-Email and X-Auth-Key', async () => {
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

  it('refuses a global key without a login email', async () => {
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

  it('refuses when CLOUDFLARE_EMAIL is a key, not an email', async () => {
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

  it('forwards a Cloudflare schema refusal', async () => {
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

  it('explains when Email Sending is off on the zone', async () => {
    const service = new CloudflareEmailService({
      accountId: 'account-id',
      apiToken: 'token',
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(403, {
          success: false,
          errors: [{ code: 10203, message: 'email.sending.error.email.sending_disabled' }],
        }),
      ) as unknown as typeof fetch,
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      name: 'EmailUnavailableError',
      message: expect.stringContaining('Email Sending is disabled'),
    })
  })

  it('hides a token refusal behind send unavailability', async () => {
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
