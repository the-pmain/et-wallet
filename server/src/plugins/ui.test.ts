import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { htmlForTransport, isApiUrl, pageContentSecurityPolicy } from '../lib/ui.ts'

function configWithStatic(staticRoot: string | null): IServerConfig {
  return {
    mode: RUNTIME_MODE.Test,
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [],
    rateLimit: { max: 10_000, windowMs: 60_000 },
    maxBodyBytes: 64 * 1024,
    catalogCacheSeconds: 300,
    supabaseUrl: null,
    supabaseAnonKey: null,
    staticRoot,
    cloudflareAccountId: null,
    cloudflareApiToken: null,
    cloudflareAuthEmail: null,
  }
}

function writeWalletDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'wallet-ui-'))
  const assets = join(root, 'assets')

  mkdirSync(assets)
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; upgrade-insecure-requests"></head><body>wallet</body></html>',
  )
  writeFileSync(join(assets, 'app.js'), 'console.log(1)')

  return root
}

describe('isApiUrl', () => {
  it('считает API только пути /v1', () => {
    expect(isApiUrl('/v1/health')).toBe(true)
    expect(isApiUrl('/v1/users?x=1')).toBe(true)
    expect(isApiUrl('/')).toBe(false)
    expect(isApiUrl('/assets/app.js')).toBe(false)
  })
})

describe('htmlForTransport', () => {
  it('на HTTP убирает upgrade-insecure-requests', () => {
    const html = "default-src 'self'; upgrade-insecure-requests"

    expect(htmlForTransport(html, false)).not.toContain('upgrade-insecure-requests')
    expect(htmlForTransport(html, true)).toContain('upgrade-insecure-requests')
  })
})

describe('Раздача интерфейса', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('без сборки оставляет GET / отказом JSON', async () => {
    app = await buildApp({ config: configWithStatic(null) })
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('отдаёт индекс кошелька на GET /', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('wallet')
    expect(response.body).not.toContain('upgrade-insecure-requests')
    expect(String(response.headers['content-security-policy'])).toBe(
      pageContentSecurityPolicy(false),
    )
    expect(String(response.headers['content-security-policy'])).toContain("script-src 'self'")
  })

  it('не подменяет JSON API статикой', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const health = await app.inject({ method: 'GET', url: '/v1/health' })
    const missing = await app.inject({ method: 'GET', url: '/v1/нет-такого' })

    expect(health.statusCode).toBe(200)
    expect(health.json<{ status: string }>().status).toBe('ok')
    expect(missing.statusCode).toBe(404)
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('на неизвестный путь без /v1 отдаёт индекс', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/unlock' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('wallet')
  })

  it('раздаёт файлы сборки', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('console.log')
    expect(response.headers['cache-control']).toContain('immutable')
  })
})
