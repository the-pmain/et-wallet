import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'

/**
 * System notifications.
 *
 * THIS ROUTE SPEAKS TO THE USER IN THE WALLET'S NAME. Text from here
 * is shown inside the wallet window and is indistinguishable from the
 * app's own messages. Hence the catalog-check limits: text only, no
 * links, bounded length.
 *
 * THE RESPONSE DOES NOT DEPEND ON WHO ASKS. The route accepts neither
 * a wallet address nor an install id: a targeted notification would
 * mean the service knows whom it is writing to.
 */
export function registerNotificationRoutes(app: FastifyInstance, catalog: CatalogService): void {
  app.get('/v1/notifications', (_request, reply) => {
    /* Cache is shorter than the catalog's: an incident notice must
       arrive quickly or it is useless. */
    void reply.header('cache-control', 'public, max-age=60')

    return { notifications: catalog.listNotifications(new Date()) }
  })
}
