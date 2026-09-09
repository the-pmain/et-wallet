import { afterEach, describe, expect, it, vi } from 'vitest'

import { EMAIL_DIRECTION } from './contracts.ts'
import { CloudflareEmailsRepository } from './CloudflareEmailsRepository.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CloudflareEmailsRepository', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('collects sent and inbound from Cloudflare GraphQL', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)

      if (url.includes('/graphql')) {
        return jsonResponse(200, {
          data: {
            viewer: {
              zones: [
                {
                  emailSendingAdaptive: [
                    {
                      datetime: '2026-08-27T09:47:00Z',
                      from: 'support@etwalletx.com',
                      to: 'user@example.com',
                      subject: 'Hello',
                      status: 'delivered',
                      eventType: 'newEmailSending',
                      messageId: '<msg-1@etwalletx.com>',
                      errorCause: '',
                    },
                  ],
                  emailRoutingAdaptive: [
                    {
                      datetime: '2026-08-27T10:00:00Z',
                      from: 'user@example.com',
                      to: 'support@etwalletx.com',
                      subject: 'Re: Hello',
                      status: 'forwarded',
                      action: 'worker',
                      eventType: 'incoming',
                      messageId: '<in-1@example.com>',
                      errorDetail: '',
                    },
                  ],
                },
              ],
            },
          },
        })
      }

      return jsonResponse(404, {})
    })

    const repository = new CloudflareEmailsRepository({
      accountId: 'account-id',
      apiToken: 'token',
      zoneId: 'zone-id',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const records = await repository.list()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(
      fetchMock.mock.calls.every((call) => !String(call[0]).includes('/rest/v1/emails')),
    ).toBe(true)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      direction: EMAIL_DIRECTION.Received,
      from: 'user@example.com',
      to: 'support@etwalletx.com',
      subject: 'Re: Hello',
    })
    expect(records[1]).toMatchObject({
      direction: EMAIL_DIRECTION.Sent,
      to: 'user@example.com',
      status: 'delivered',
      id: 'msg-1@etwalletx.com',
    })
  })

  it('does not write to Supabase: create stays on top of the Cloudflare list', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes('/graphql')) {
        return jsonResponse(200, {
          data: { viewer: { zones: [{ emailSendingAdaptive: [], emailRoutingAdaptive: [] }] } },
        })
      }

      return jsonResponse(404, {})
    })

    const repository = new CloudflareEmailsRepository({
      accountId: 'account-id',
      apiToken: 'token',
      zoneId: 'zone-id',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await repository.create({
      direction: EMAIL_DIRECTION.Sent,
      from: 'support@etwalletx.com',
      to: 'user@example.com',
      subject: 'Just sent',
      text: 'Body',
      status: 'queued',
      externalId: 'local-1',
    })

    const records = await repository.list()

    expect(
      fetchMock.mock.calls.every((call) => !String(call[0]).includes('/rest/v1/emails')),
    ).toBe(true)
    expect(records[0]).toMatchObject({
      subject: 'Just sent',
      text: 'Body',
      to: 'user@example.com',
    })
  })

  it('does not drop the list when Cloudflare GraphQL errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { errors: [{ message: 'authz' }] }),
    )

    const repository = new CloudflareEmailsRepository({
      accountId: 'account-id',
      apiToken: 'token',
      zoneId: 'zone-id',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await repository.create({
      direction: EMAIL_DIRECTION.Sent,
      from: 'support@etwalletx.com',
      to: 'user@example.com',
      subject: 'Queued locally',
      text: 'Body',
      status: 'queued',
      externalId: 'local-2',
    })

    await expect(repository.list()).resolves.toMatchObject([
      { subject: 'Queued locally', to: 'user@example.com' },
    ])
  })
})
