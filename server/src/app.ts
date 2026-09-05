import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

import { registerAdminRoutes } from './api/admin.routes.ts'
import { registerCatalogRoutes } from './api/catalog.routes.ts'
import { registerNotificationRoutes } from './api/notifications.routes.ts'
import { registerSendingRoutes } from './api/sendings.routes.ts'
import { registerSettingsRoutes } from './api/settings.routes.ts'
import { registerUserRoutes } from './api/users.routes.ts'
import { registerVersionRoutes } from './api/version.routes.ts'
import { CatalogService } from './catalog/CatalogService.ts'
import { RUNTIME_MODE, type IServerConfig } from './config.ts'
import { ApiError } from './lib/errors.ts'
import { isApiUrl, isStaticAssetUrl } from './lib/ui.ts'
import { registerSecretGuard } from './plugins/secret-guard.ts'
import { registerSecurity } from './plugins/security.ts'
import { registerUi, sendWalletIndex } from './plugins/ui.ts'
import { MemorySettingsRepository } from './settings/MemorySettingsRepository.ts'
import type { ISettingsRepository } from './settings/contracts.ts'
import { MemorySendingsRepository } from './sendings/MemorySendingsRepository.ts'
import { SendingsHub } from './sendings/SendingsHub.ts'
import { SendingsService } from './sendings/SendingsService.ts'
import { SendingsDatabaseError } from './sendings/SupabaseRestSendingsRepository.ts'
import type { ISendingsRepository } from './sendings/contracts.ts'
import { MemoryUsersRepository } from './users/MemoryUsersRepository.ts'
import { USERS_STORE_KIND, type IUsersRepository, type UsersStoreKind } from './users/contracts.ts'
import { UsersDatabaseError } from './users/SupabaseRestUsersRepository.ts'

/**
 * Application dependencies.
 *
 * Injected, not created inside: a test must be able to supply its own
 * catalog and store without bringing up a network or a database.
 */
export interface IAppDependencies {
  readonly config: IServerConfig
  readonly catalog?: CatalogService
  readonly settings?: ISettingsRepository
  readonly users?: IUsersRepository
  readonly usersKind?: UsersStoreKind
  readonly sendings?: ISendingsRepository
  readonly sendingsStorageWarning?: string | null
  readonly sendingsHub?: SendingsHub
}

/**
 * Request fields that go into the log.
 *
 * ALLOW-LIST, NOT DENY-LIST. A hide-list must grow with every new field,
 * and someone will forget. An allow-list does not grow when a new field
 * appears.
 *
 * REQUEST BODIES ARE NEVER LOGGED. The only body in the service is
 * settings ciphertext; a log full of other people's ciphertext helps
 * nobody and remains a target.
 */
function requestSerializer(request: {
  readonly method: string
  readonly url: string
  readonly routeOptions?: { readonly url?: string | undefined }
}) {
  return {
    method: request.method,
    /* Log the route template, not the concrete URL: the sync path
       contains an identifier, and that identifier is a bearer key.
       An identifier in the log is a leaked key. */
    route: request.routeOptions?.url ?? request.url.split('?')[0],
  }
}

/**
 * Builds the application.
 *
 * REGISTRATION ORDER MATTERS. Security wrapping and the inbound-data
 * guard go on before routes: otherwise a request could reach a handler
 * before the check.
 */
export async function buildApp(dependencies: IAppDependencies): Promise<FastifyInstance> {
  const { config } = dependencies

  const app = Fastify({
    logger: {
      level: config.mode === RUNTIME_MODE.Test ? 'silent' : 'info',
      serializers: { req: requestSerializer },
    },
    bodyLimit: config.maxBodyBytes,
    ajv: {
      customOptions: {
        /* Fastify by default STRIPS fields not described by the schema
           and continues. That is unacceptable here: a client that sent
           an extra field would get "accepted" and assume the service
           understood it. A request that does not match the schema must
           be rejected whole. */
        removeAdditional: false,

        /* Type coercion also silently changes meaning: the string "0"
           would become a number, and the record revision is the value
           that decides whether someone else's changes get overwritten. */
        coerceTypes: false,
      },
    },
    /* Request id is not derived from the client address: it goes into
       the response, and a user's address in the response is information
       about them, sent to everyone who sees the response. */
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.mode === RUNTIME_MODE.Production,
  })

  await registerSecurity(app, config)
  registerSecretGuard(app)

  /* The catalog is checked in the constructor: a service with a corrupt
     catalog must not start, not begin serving wrong addresses. */
  const catalog = dependencies.catalog ?? new CatalogService()
  const settings = dependencies.settings ?? new MemorySettingsRepository()
  const users = dependencies.users ?? new MemoryUsersRepository()
  const usersKind = dependencies.usersKind ?? USERS_STORE_KIND.Memory
  const sendings = dependencies.sendings ?? new MemorySendingsRepository()
  const sendingsService = new SendingsService(sendings, users)
  const sendingsHub = dependencies.sendingsHub ?? new SendingsHub()

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      if (error instanceof UsersDatabaseError || error instanceof SendingsDatabaseError) {
        request.log.error(
          {
            route: request.routeOptions.url,
            operation: error.operation,
            supabaseCode: error.supabaseCode,
          },
          error instanceof SendingsDatabaseError ? 'sendings database error' : 'users database error',
        )
      }

      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })

      return
    }

    /* Schema rejection is a client error. Log field names and the Ajv
       code, not values: `the_p` is among the fields. */
    if (error.validation !== undefined) {
      const keys = bodyKeys(request.body)

      request.log.warn(
        {
          route: request.routeOptions.url,
          keys,
          validation: error.validation.map((item) => ({
            keyword: item.keyword,
            instancePath: item.instancePath,
            params: item.params,
          })),
        },
        'Request body failed the schema',
      )

      void reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request does not match the schema.',
          ...(config.mode === RUNTIME_MODE.Development ? { receivedFields: keys } : {}),
        },
      })

      return
    }

    /* Everything else stays inside. An unexpected error message contains
       file paths and internal module names: that helps an attacker and
       does not help the user. */
    request.log.error({ err: error }, 'Unhandled error')

    void reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal service error.' },
    })
  })

  app.get('/v1/health', () => ({
    status: 'ok',
    users: usersKind,
    credentials: ['email', 'the_p'],
  }))

  registerCatalogRoutes(app, catalog, config)
  registerNotificationRoutes(app, catalog)
  registerVersionRoutes(app, catalog)
  registerSettingsRoutes(app, settings, config)
  registerUserRoutes(app, users)
  registerSendingRoutes(app, sendingsService, sendingsHub)
  registerAdminRoutes(app, users)

  if (config.staticRoot !== null) {
    await registerUi(app, config.staticRoot)
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      config.staticRoot !== null &&
      request.method === 'GET' &&
      !isApiUrl(request.url) &&
      !isStaticAssetUrl(request.url)
    ) {
      void sendWalletIndex(config.staticRoot, request, reply)

      return
    }

    void reply.status(404).send({
      error: { code: 'not_found', message: 'The route does not exist.' },
    })
  })

  /* A Fastify instance is thenable: awaiting it finishes plugin
     registration. An explicit `await` makes that visible instead of
     relying on returning from an async function to do the same implicitly. */
  return await app
}

/** Body field names without values — so `the_p` does not reach the response or the log. */
function bodyKeys(body: unknown): readonly string[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return []
  }

  return Object.keys(body)
}
