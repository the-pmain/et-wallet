import { describe, expect, it, vi } from 'vitest'

import { NullLogger } from '@/test/doubles'

import { RemoteAuthError, RemoteUserDirectory } from './RemoteUserDirectory'

const USER_BODY = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-19T12:00:00.000Z',
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

describe('RemoteUserDirectory', () => {
  it('шлёт POST на заданный адрес и возвращает созданную запись', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.register({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      balance: '0',
      the_p: 'demo',
    })
    expect(user).toEqual(USER_BODY)
  })

  it('в разработке ходит на тот же origin через /v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, USER_BODY))
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    await directory.register({ email: 'james@example.com', balance: '0', theP: 'demo' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/users')
  })

  it('бросает, если справочник недоступен', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })

    await expect(
      directory.register({ email: 'james@example.com', balance: '0', theP: 'demo' }),
    ).rejects.toBeInstanceOf(RemoteAuthError)
  })

  it('бросает, если запись отвергнута', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'invalid_request' } })),
      }) as unknown as typeof fetch,
    })

    await expect(
      directory.register({ email: 'james@example.com', balance: '0', theP: 'demo' }),
    ).rejects.toMatchObject({ name: 'RemoteAuthError', status: 400 })
  })

  it('входит по почте и the_p и возвращает данные записи', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...USER_BODY,
        balance: '12.5',
      }),
    )
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    const user = await directory.authenticate({ email: 'james@example.com', theP: 'demo' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users/auth')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'james@example.com',
      the_p: 'demo',
    })
    expect(user).toEqual({
      id: '7',
      email: 'james@example.com',
      balance: '12.5',
      createdAt: '2026-08-19T12:00:00.000Z',
    })
  })

  it('бросает RemoteAuthError, если the_p не совпала', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'unauthorized' } })),
      }) as unknown as typeof fetch,
    })

    await expect(
      directory.authenticate({ email: 'james@example.com', theP: 'wrong' }),
    ).rejects.toBeInstanceOf(RemoteAuthError)
  })
})
