import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { htmlForTransport, isHttpsRequest, pageContentSecurityPolicy } from '../lib/ui.ts'

/**
 * Раздача собранного кошелька с того же источника, что и `/v1`.
 *
 * `BrowserRouter` ходит на `/wallet`, `/admin` и остальные пути
 * приложения. Неизвестный путь без `/v1` отдаёт `index.html`:
 * обновление страницы не должно показывать JSON 404.
 */
export async function registerUi(app: FastifyInstance, staticRoot: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    wildcard: false,
    index: false,
    decorateReply: true,
    allowedPath: (pathName) => {
      const normalized = pathName.replaceAll('\\', '/')

      return !normalized.endsWith('/_headers') && !normalized.includes('/deploy/')
    },
    setHeaders: (reply, pathName) => {
      const normalized = pathName.replaceAll('\\', '/')

      if (normalized.includes('/assets/')) {
        reply.header('cache-control', 'public, max-age=31536000, immutable')
      }

      reply.header('cross-origin-resource-policy', 'same-origin')
    },
  })

  app.get('/', async (request, reply) => {
    await sendWalletIndex(staticRoot, request, reply)
  })
}

export async function sendWalletIndex(
  staticRoot: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const html = await readFile(join(staticRoot, 'index.html'), 'utf8')
  const https = isHttpsRequest(request)

  void reply
    .status(200)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-cache')
    .header('content-security-policy', pageContentSecurityPolicy(https))
    .header('cross-origin-resource-policy', 'same-origin')
    .send(htmlForTransport(html, https))
}
