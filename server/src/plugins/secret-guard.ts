import type { FastifyInstance } from 'fastify'

import { findSecretKind } from '../lib/secret-patterns.ts'

/**
 * Inbound-data guard.
 *
 * WHAT IT DOES. Rejects a request whose body looks like a private key
 * or a mnemonic — before the body is parsed, logged, or stored.
 *
 * WHY, IF NO ROUTE ACCEPTS THAT. Because "no route" is a claim about
 * today's code. A route added later may accept a field nobody thought
 * of. The guard turns "the service does not receive secrets" from
 * intent into behavior that does not depend on the next change being
 * careful.
 *
 * WHAT IT DOES NOT DO. It does not save the user: a secret that went
 * on the wire is already compromised — proxies and the TLS terminator
 * have seen it. The guard limits the damage and makes the mistake
 * visible immediately.
 *
 * REJECTED REQUEST CONTENT IS NOT LOGGED. Recording that a private
 * key arrived is useful; recording the key itself would turn the
 * defense into a leak.
 */
const EMAIL_SEND_ROUTE = '/v1/admin/email/send'
const EMAIL_INBOUND_ROUTE = '/v1/webhooks/email-inbound'

export function registerSecretGuard(app: FastifyInstance): void {
  app.addHook('preValidation', (request, reply, done) => {
    /* Mail is connected prose. The "twelve short words" rule matches
       an ordinary English paragraph, and a transaction hash matches
       the private-key pattern. The cabinet is already behind a PIN. */
    if (
      request.routeOptions.url === EMAIL_SEND_ROUTE ||
      request.routeOptions.url === EMAIL_INBOUND_ROUTE
    ) {
      done()

      return
    }

    const { body } = request

    if (body === undefined || body === null) {
      done()

      return
    }

    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    const kind = findSecretKind(payload)

    if (kind === null) {
      done()

      return
    }

    request.log.warn(
      { route: request.routeOptions.url, kind },
      'Request rejected: the body contains data this service must never hold',
    )

    void reply.status(400).send({
      error: {
        code: 'secret_material_rejected',
        message:
          'The request body looks like a private key or a seed phrase. ' +
          'This service does not accept those under any circumstances. ' +
          'Treat the value you sent as compromised and replace it.',
      },
    })
  })
}
