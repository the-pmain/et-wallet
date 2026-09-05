import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'

/**
 * App version check.
 *
 * THE RESPONSE HAS NO DOWNLOAD URL. A service that says "download the
 * update from here" is a ready way to send the user to a fake
 * installer: one swapped string in the response is enough. The store
 * URL is baked into the client.
 *
 * THIS IS A SUPPORT STATEMENT, NOT A KILL SWITCH. A non-custodial
 * wallet must work even when its service is down or hostile.
 * The client shows a warning and keeps working.
 *
 * CLIENT VERSION IS OPTIONAL. Without it there is nothing to compare,
 * and support flags return `null`: "we do not know" must not become
 * "all is well" or "time to update".
 */

const VERSION_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
  },
} as const

interface IVersionQuery {
  readonly version?: string
}

export function registerVersionRoutes(app: FastifyInstance, catalog: CatalogService): void {
  app.get<{ Querystring: IVersionQuery }>(
    '/v1/app/version',
    { schema: { querystring: VERSION_QUERY } },
    (request, reply) => {
      void reply.header('cache-control', 'public, max-age=300')

      return catalog.getVersionStatus(request.query.version ?? null)
    },
  )
}
