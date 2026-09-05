import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { htmlForTransport, isHttpsRequest, pageContentSecurityPolicy } from '../lib/ui.ts'

/**
 * Serves the built wallet from the same origin as `/v1`.
 *
 * `BrowserRouter` hits `/wallet`, `/admin` and the other app paths.
 * An unknown path without `/v1` gets `index.html`: a page refresh
 * must not show a JSON 404.
 */
export async function registerUi(app: FastifyInstance, staticRoot: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    /* `true`: files are looked up at request time. `false` snapped
       the directory at start, and after `npm run build` new hashed
       names fell through to the HTML stub with MIME `text/html` —
       the browser refused to execute the module. */
    wildcard: true,
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

  app.get('/robots.txt', async (_request, reply) => {
    /* Explicit route, not static: an unknown GET serves index.html,
       and a robot would get HTML instead of a crawl ban. */
    const body = await readFile(join(staticRoot, 'robots.txt'), 'utf8')

    void reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(body)
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
