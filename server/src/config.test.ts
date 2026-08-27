import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from './config.ts'

const KEYS = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'ALLOWED_ORIGINS',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_STATIC_URL',
  'STATIC_ROOT',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_EMAIL',
  'MAIL_FROM',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'EMAIL_WEBHOOK_SECRET',
] as const

const snapshot = new Map<string, string | undefined>()

function isolateEnv(values: Record<string, string | undefined>): void {
  for (const key of KEYS) {
    snapshot.set(key, process.env[key])
    delete process.env[key]
  }

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  for (const key of KEYS) {
    const previous = snapshot.get(key)

    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }

  snapshot.clear()
})

describe('loadConfig', () => {
  it('в разработке слушает 127.0.0.1', () => {
    isolateEnv({ NODE_ENV: 'development' })

    expect(loadConfig().host).toBe('127.0.0.1')
  })

  it('в бою без HOST слушает все интерфейсы', () => {
    isolateEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://wallet.example' })

    expect(loadConfig().host).toBe('0.0.0.0')
  })

  it('на Railway без HOST слушает все интерфейсы', () => {
    isolateEnv({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT: 'production',
    })

    expect(loadConfig().host).toBe('0.0.0.0')
  })

  it('на Railway игнорирует HOST=127.0.0.1 из локального .env', () => {
    isolateEnv({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      RAILWAY_ENVIRONMENT: 'production',
      RAILWAY_PUBLIC_DOMAIN: 'wallet-prod.up.railway.app',
    })

    expect(loadConfig().host).toBe('0.0.0.0')
  })

  it('в бою берёт публичный домен Railway, если CORS не задан', () => {
    isolateEnv({
      NODE_ENV: 'production',
      RAILWAY_PUBLIC_DOMAIN: 'wallet-prod.up.railway.app',
    })

    expect(loadConfig().allowedOrigins).toEqual(['https://wallet-prod.up.railway.app'])
  })

  it('в бою без CORS и без Railway отказывается стартовать', () => {
    isolateEnv({ NODE_ENV: 'production' })

    expect(() => loadConfig()).toThrow(/ALLOWED_ORIGINS/u)
  })

  it('читает ключи Cloudflare Email Sending', () => {
    isolateEnv({
      NODE_ENV: 'development',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_EMAIL: 'owner@example.com',
      MAIL_FROM: 'support@etwalletx.com',
      R2_ACCESS_KEY_ID: 'r2-key',
      R2_SECRET_ACCESS_KEY: 'r2-secret',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      R2_BUCKET: 'etwallet-emails',
    })

    const config = loadConfig()

    expect(config.cloudflareAccountId).toBe('account-id')
    expect(config.cloudflareApiToken).toBe('token')
    expect(config.cloudflareAuthEmail).toBe('owner@example.com')
    expect(config.mailFrom).toBe('support@etwalletx.com')
    expect(config.r2AccessKeyId).toBe('r2-key')
    expect(config.r2SecretAccessKey).toBe('r2-secret')
    expect(config.r2Endpoint).toBe('https://example.r2.cloudflarestorage.com')
    expect(config.r2Bucket).toBe('etwallet-emails')
    expect(config.emailWebhookSecret).toBeNull()
  })

  it('читает секрет входящего вебхука', () => {
    isolateEnv({
      NODE_ENV: 'development',
      EMAIL_WEBHOOK_SECRET: 'inbound-secret',
    })

    expect(loadConfig().emailWebhookSecret).toBe('inbound-secret')
  })
})
