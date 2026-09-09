import { describe, expect, it, vi } from 'vitest'

import { EMAIL_DIRECTION } from './contracts.ts'
import { R2EmailsRepository } from './R2EmailsRepository.ts'

function xmlList(keys: readonly string[]): string {
  return `<ListBucketResult>${keys.map((key) => `<Contents><Key>${key}</Key></Contents>`).join('')}</ListBucketResult>`
}

describe('R2EmailsRepository', () => {
  it('writes a message and reads the journal', async () => {
    const objects = new Map<string, string>()
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const parsed = new URL(url)

      if (method === 'GET' && parsed.searchParams.get('list-type') === '2') {
        return new Response(xmlList([...objects.keys()]), { status: 200 })
      }

      if (method === 'PUT') {
        const key = decodeURIComponent(parsed.pathname.replace(/^\/etwallet-emails\//u, ''))
        objects.set(key, String(init?.body ?? ''))

        return new Response('', { status: 200 })
      }

      if (method === 'GET') {
        const key = decodeURIComponent(parsed.pathname.replace(/^\/etwallet-emails\//u, ''))
        const body = objects.get(key)

        return new Response(body ?? '', { status: body === undefined ? 404 : 200 })
      }

      return new Response('', { status: 404 })
    })

    const repository = new R2EmailsRepository({
      endpoint: 'https://example.r2.cloudflarestorage.com',
      bucket: 'etwallet-emails',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await repository.ensureReady()
    const created = await repository.create({
      direction: EMAIL_DIRECTION.Sent,
      from: 'support@etwalletx.com',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Hi',
      html: '<p>Hi</p>',
      status: 'delivered',
    })
    const listed = await repository.list()

    expect(created.to).toBe('user@example.com')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      subject: 'Hello',
      direction: 'sent',
      to: 'user@example.com',
    })
  })

  it('creates the bucket when the list returns 404', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.includes('r2/buckets') && method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      return new Response('NoSuchBucket', { status: 404 })
    })

    const repository = new R2EmailsRepository({
      endpoint: 'https://example.r2.cloudflarestorage.com',
      bucket: 'etwallet-emails',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      accountId: 'account',
      apiToken: 'token',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await repository.ensureReady()

    const create = fetchMock.mock.calls.find((call) => String(call[0]).includes('/r2/buckets'))

    expect(create).toBeDefined()
  })
})
