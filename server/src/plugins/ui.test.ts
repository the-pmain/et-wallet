import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'
import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { htmlForTransport, isApiUrl, isStaticAssetUrl, pageContentSecurityPolicy } from '../lib/ui.ts'

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
    supabasePublishableKey: null,
    supabaseServiceRoleKey: null,
    staticRoot,
    cloudflareAccountId: null,
    cloudflareApiToken: null,
    cloudflareAuthEmail: null,
    mailFrom: null,
    r2AccessKeyId: null,
    r2SecretAccessKey: null,
    r2Endpoint: null,
    r2Bucket: null,
    emailWebhookSecret: null,
    adminPin: null,
    superAdminPin: null,
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
  writeFileSync(join(root, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
  writeFileSync(join(assets, 'app.js'), 'console.log(1)')

  return root
}

describe('isApiUrl', () => {
  it('treats only /v1 paths as API', () => {
    expect(isApiUrl('/v1/health')).toBe(true)
    expect(isApiUrl('/v1/users?x=1')).toBe(true)
    expect(isApiUrl('/')).toBe(false)
    expect(isApiUrl('/assets/app.js')).toBe(false)
  })
})

describe('isStaticAssetUrl', () => {
  it('distinguishes a build file from an app route', () => {
    expect(isStaticAssetUrl('/assets/index-abc.js')).toBe(true)
    expect(isStaticAssetUrl('/assets/index-abc.css')).toBe(true)
    expect(isStaticAssetUrl('/robots.txt')).toBe(true)
    expect(isStaticAssetUrl('/wallet')).toBe(false)
    expect(isStaticAssetUrl('/admin/sendings')).toBe(false)
  })
})

describe('htmlForTransport', () => {
  it('on HTTP strips upgrade-insecure-requests', () => {
    const html = "default-src 'self'; upgrade-insecure-requests"

    expect(htmlForTransport(html, false)).not.toContain('upgrade-insecure-requests')
    expect(htmlForTransport(html, true)).toContain('upgrade-insecure-requests')
  })
})

describe('UI serving', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('without a build leaves GET / as a JSON refusal', async () => {
    app = await buildApp({ config: configWithStatic(null) })
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('serves the wallet index on GET /', async () => {
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

  it('does not replace the JSON API with static files', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const health = await app.inject({ method: 'GET', url: '/v1/health' })
    const missing = await app.inject({ method: 'GET', url: '/v1/no-such-route' })

    expect(health.statusCode).toBe(200)
    expect(health.json<{ status: string }>().status).toBe('ok')
    expect(missing.statusCode).toBe(404)
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('on an unknown path without /v1 serves the index', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/unlock' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('wallet')
  })

  it('serves build files', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('console.log')
    expect(response.headers['cache-control']).toContain('immutable')
    expect(String(response.headers['content-type'])).not.toContain('text/html')
  })

  it('serves a file that appeared after start', async () => {
    /* The build changes hashed names while the process is already
       listening. A directory snapshot at start would leave new files
       without a route, and an HTML page would go out instead of
       the bytes. */
    const root = writeWalletDist()
    app = await buildApp({ config: configWithStatic(root) })
    writeFileSync(join(root, 'assets', 'late.js'), 'window.__late = 1')

    const response = await app.inject({ method: 'GET', url: '/assets/late.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('window.__late')
    expect(String(response.headers['content-type'])).not.toContain('text/html')
  })

  it('answers a missing build file with a refusal, not HTML', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/assets/missing-hash.js' })

    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain('wallet')
  })

  it('serves robots.txt with a crawl ban', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatch(/^User-agent:\s*\*/m)
    expect(response.body).toMatch(/^Disallow: \/$/m)
    expect(response.headers['x-robots-tag']).toContain('noindex')
  })

  it('forbids indexing of wallet HTML', async () => {
    app = await buildApp({ config: configWithStatic(writeWalletDist()) })
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.headers['x-robots-tag']).toContain('noindex')
  })
})
