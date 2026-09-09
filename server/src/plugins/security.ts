import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { API_CONTENT_SECURITY_POLICY, isApiUrl } from '../lib/ui.ts'

/**
 * Matches `ROBOTS_TAG_VALUE` in `build/security-headers-plugin.ts`
 * and the meta tag in `index.html`. The JSON API must not be indexed
 * either: a response without HTML carries no meta tag.
 */
const ROBOTS_TAG_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex'

/**
 * Security wrapping.
 *
 * HEADERS. JSON (`/v1`) must not execute as a page:
 * `Content-Security-Policy` for those responses forbids everything.
 * The wallet page, if served from the same process, gets a separate
 * policy in `plugins/ui.ts` — otherwise the bundle will not start.
 *
 * RATE LIMIT. A reference service with no limit falls over from one
 * script. Wallet static files are outside the limit: otherwise loading
 * the bundle would burn the API quota.
 *
 * CORS. For catalog reads this is not protection — the data is public
 * anyway — it is surface reduction. The important part: the service
 * uses neither cookies nor an authorization header, so the browser
 * attaches no implicit credentials, and a forged request from a
 * third-party site gains nothing.
 */
export async function registerSecurity(app: FastifyInstance, config: IServerConfig): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    /* Default is `SAMEORIGIN`, so same-origin framing is allowed.
       Neither JSON nor the wallet should appear in a frame. */
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: false,
  })

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-robots-tag', ROBOTS_TAG_VALUE)

    if (isApiUrl(request.url)) {
      void reply.header('content-security-policy', API_CONTENT_SECURITY_POLICY)
      void reply.header('cross-origin-resource-policy', 'cross-origin')
    }
  })

  await app.register(cors, {
    origin:
      config.allowedOrigins.length === 0 && config.mode !== RUNTIME_MODE.Production
        ? true
        : [...config.allowedOrigins],
    /* PATCH is required by the admin cabinet: balance and `wallets`
       updates are partial, not a full record replace. */
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type', 'x-admin-pin'],
    /* Credentials are not sent: the service uses neither cookies nor
       an authorization header. Allowing them would let the browser
       attach something the user does not know about. */
    credentials: false,
    maxAge: 600,
  })

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    allowList: (request) => !isApiUrl(request.url),
    /* The rate-limit response does not say who spent how much:
       that is information about other users on the same address. */
    errorResponseBuilder: () => ({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Try again later.',
      },
    }),
  })
}
