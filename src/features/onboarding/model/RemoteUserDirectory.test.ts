import { describe, expect, it, vi } from 'vitest'

import { NullLogger } from '@/test/doubles'

import { RemoteUserDirectory } from './RemoteUserDirectory'

describe('RemoteUserDirectory', () => {
  it('шлёт POST на заданный адрес', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const directory = new RemoteUserDirectory({
      baseUrl: 'http://127.0.0.1:8080',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    await directory.register({ username: 'James', balance: '0', theP: 'demo' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/users')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      username: 'James',
      balance: '0',
      the_p: 'demo',
    })
  })

  it('в разработке ходит на тот же origin через /v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: fetchMock as unknown as typeof fetch,
    })

    await directory.register({ username: 'James', balance: '0', theP: null })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/users')
  })

  it('глотает отказ сети', async () => {
    const directory = new RemoteUserDirectory({
      baseUrl: '',
      logger: new NullLogger(),
      fetch: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })

    await expect(
      directory.register({ username: 'James', balance: '0', theP: null }),
    ).resolves.toBeUndefined()
  })
})
