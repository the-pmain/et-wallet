import { resolveStaticRoot } from './lib/staticRoot.ts'

/**
 * Service settings from the environment.
 *
 * DEFAULTS ARE SAFE FOR DEVELOPMENT, NOT PRODUCTION.
 * Where a safe default is impossible — the allowed-origins list —
 * the service refuses to start in production without an explicit setting.
 * A silent "allow all" in prod is worse than a refusal: the refusal is
 * noticed at deploy time.
 */

export const RUNTIME_MODE = {
  Development: 'development',
  Production: 'production',
  Test: 'test',
} as const

export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE]

export interface IServerConfig {
  readonly mode: RuntimeMode
  readonly host: string
  readonly port: number

  /**
   * Origins allowed for cross-origin requests.
   *
   * An empty list in development means "any"; in production an empty
   * list is a startup error.
   */
  readonly allowedOrigins: readonly string[]

  readonly rateLimit: {
    readonly max: number
    readonly windowMs: number
  }

  readonly maxBodyBytes: number

  readonly catalogCacheSeconds: number

  /**
   * Supabase project URL (`https://….supabase.co`).
   *
   * `null` until the `.env` field is filled: user records then stay
   * in process memory.
   */
  readonly supabaseUrl: string | null

  /** Anon key. Server-only. Fallback for the user-scoped client. */
  readonly supabaseAnonKey: string | null

  /**
   * Project publishable key (`SUPABASE_PUBLISHABLE_KEY`).
   *
   * For the user-scoped client. Falls back to `SUPABASE_ANON_KEY` if empty.
   * Server-only. Never bundled into the wallet.
   */
  readonly supabasePublishableKey: string | null

  /**
   * Service-role key. Bypasses RLS on `public.users`.
   *
   * Trusted Node process only, after `email`/`the_p` or PIN check.
   * Do not pick by a request field. Do not send to the client.
   */
  readonly supabaseServiceRoleKey: string | null

  /**
   * Built wallet directory (`index.html`).
   *
   * `null` — the service answers JSON only. Then `GET /` is 404.
   */
  readonly staticRoot: string | null

  /**
   * Cloudflare account id for Email Sending.
   *
   * `null` until the `.env` field is filled: the admin UI then shows
   * that sending is not configured and does not call the API.
   */
  readonly cloudflareAccountId: string | null

  /**
   * Cloudflare token with Email Sending (`cfut_` / `cfat_`)
   * or a global key (`cfk_`).
   *
   * Server-only. Never bundled into the wallet.
   */
  readonly cloudflareApiToken: string | null

  /**
   * Cloudflare login email.
   *
   * Needed only for a global key: the API takes it as
   * `X-Auth-Email` + `X-Auth-Key`. Unused for an API token.
   */
  readonly cloudflareAuthEmail: string | null

  /**
   * Default From address in the mail manager.
   *
   * Must belong to a domain connected to Email Sending.
   */
  readonly mailFrom: string | null

  /**
   * Cloudflare R2 (S3) keys.
   *
   * The mail manager journal is read from Cloudflare GraphQL, not R2.
   */
  readonly r2AccessKeyId: string | null
  readonly r2SecretAccessKey: string | null
  readonly r2Endpoint: string | null
  readonly r2Bucket: string | null

  /**
   * Shared secret for `POST /v1/webhooks/email-inbound`.
   *
   * `null` — the inbound webhook rejects every request (501/503).
   * The Cloudflare Email Routing worker sends it in `x-email-webhook-secret`.
   */
  readonly emailWebhookSecret: string | null

  /**
   * Admin-cabinet PIN (`/admin`), read-only.
   *
   * From `ADMIN_PIN` only. No value in server source.
   * Do not send to the client or log.
   */
  readonly adminPin: string | null

  /**
   * Super-admin PIN: same screens and full write access.
   *
   * From `SUPER_ADMIN_PIN` only. No value in server source.
   */
  readonly superAdminPin: string | null
}

const DEFAULT_PORT = 8080
const DEFAULT_RATE_LIMIT_MAX = 120
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Request-body limit.
 *
 * The only route that accepts a body is settings sync, and it accepts
 * ciphertext. Sixty-four kilobytes is enough for any settings and not
 * enough to turn the service into free file storage.
 */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024

const DEFAULT_CATALOG_CACHE_SECONDS = 300

/** Reads a number from the environment, rejecting junk instead of silently substituting. */
function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]

  if (raw === undefined || raw.trim() === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive number, received: ${raw}`,
    )
  }

  return parsed
}

function readMode(): RuntimeMode {
  const raw = process.env['NODE_ENV'] ?? RUNTIME_MODE.Development

  if (raw === RUNTIME_MODE.Production || raw === RUNTIME_MODE.Test) {
    return raw
  }

  return RUNTIME_MODE.Development
}

/**
 * Builds settings from the environment.
 *
 * @throws Error if a setting is required in production and is missing.
 */
export function loadConfig(): IServerConfig {
  const mode = readMode()
  const allowedOrigins = readAllowedOrigins(mode)

  return {
    mode,
    host: readHost(mode),
    port: readNumber('PORT', DEFAULT_PORT),
    allowedOrigins,
    rateLimit: {
      max: readNumber('RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
      windowMs: readNumber('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS),
    },
    maxBodyBytes: readNumber('MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES),
    catalogCacheSeconds: readNumber('CATALOG_CACHE_SECONDS', DEFAULT_CATALOG_CACHE_SECONDS),
    supabaseUrl: readOptionalUrl('SUPABASE_URL'),
    supabaseAnonKey: readOptional('SUPABASE_ANON_KEY'),
    supabasePublishableKey: readOptional('SUPABASE_PUBLISHABLE_KEY'),
    supabaseServiceRoleKey: readOptional('SUPABASE_SERVICE_ROLE_KEY'),
    staticRoot: resolveStaticRoot({
      configured: readOptional('STATIC_ROOT'),
      searchDefaults: mode !== RUNTIME_MODE.Test,
    }),
    cloudflareAccountId: readOptional('CLOUDFLARE_ACCOUNT_ID'),
    cloudflareApiToken: readOptional('CLOUDFLARE_API_TOKEN'),
    cloudflareAuthEmail: readOptional('CLOUDFLARE_EMAIL'),
    mailFrom: readOptional('MAIL_FROM'),
    r2AccessKeyId: readOptional('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: readOptional('R2_SECRET_ACCESS_KEY'),
    r2Endpoint: readOptionalUrl('R2_ENDPOINT'),
    r2Bucket: readOptional('R2_BUCKET'),
    emailWebhookSecret: readOptional('EMAIL_WEBHOOK_SECRET'),
    adminPin: readOptional('ADMIN_PIN'),
    superAdminPin: readOptional('SUPER_ADMIN_PIN'),
  }
}

/**
 * Listen address.
 *
 * On Railway and in production without an explicit HOST the process must
 * listen on all interfaces: 127.0.0.1 is invisible outside the container.
 */
function readHost(mode: RuntimeMode): string {
  const configured = readOptional('HOST')
  const onRailway = readOptional('RAILWAY_ENVIRONMENT') !== null

  if (configured !== null && !(onRailway && configured === '127.0.0.1')) {
    return configured
  }

  if (mode === RUNTIME_MODE.Production || onRailway) {
    return '0.0.0.0'
  }

  return '127.0.0.1'
}

/**
 * CORS list.
 *
 * An empty list in development means "any origin". In production the list
 * is required: a silent "allow all" is worse than a refusal. On Railway,
 * if the variable is unset, the platform public URL is used so a fullstack
 * deploy on the same domain starts without a manual setting.
 */
function readAllowedOrigins(mode: RuntimeMode): readonly string[] {
  const configured = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')

  if (configured.length > 0) {
    return configured
  }

  if (mode !== RUNTIME_MODE.Production) {
    return []
  }

  const railwayOrigin = railwayPublicOrigin()

  if (railwayOrigin !== null) {
    return [railwayOrigin]
  }

  throw new Error(
    'ALLOWED_ORIGINS is required in production. ' +
      'Silently allowing requests from any origin would let any page ' +
      'call the service in the user\'s browser.',
  )
}

/** Railway public URL, if the platform provided one. */
function railwayPublicOrigin(): string | null {
  const staticUrl = readOptional('RAILWAY_STATIC_URL')

  if (staticUrl !== null) {
    return staticUrl.replace(/\/$/u, '')
  }

  const domain = readOptional('RAILWAY_PUBLIC_DOMAIN')

  if (domain === null) {
    return null
  }

  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain.replace(/\/$/u, '')
  }

  return `https://${domain}`
}

/** Reads an optional string, treating a blank value as absent. */
function readOptional(name: string): string | null {
  const raw = process.env[name]

  if (raw === undefined || raw.trim() === '') {
    return null
  }

  return raw.trim()
}

/** Reads a project URL, stripping a trailing `/rest/v1` if it was pasted in. */
function readOptionalUrl(name: string): string | null {
  const raw = readOptional(name)

  if (raw === null) {
    return null
  }

  return raw
    .replace(/\/rest\/v1\/users\/?$/u, '')
    .replace(/\/rest\/v1\/?$/u, '')
    .replace(/\/$/u, '')
}
