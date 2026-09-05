import type { FastifyInstance } from 'fastify'

import type { IServerConfig } from '../config.ts'
import { NotFoundError } from '../lib/errors.ts'
import type { ISettingsRepository } from '../settings/contracts.ts'

/**
 * User settings sync.
 *
 * THE SERVICE STORES CIPHERTEXT AND CANNOT READ IT. The key is derived
 * on the device; the service has neither decryption nor a place such a
 * key could be passed to. Reading the code shows this: the body is one
 * string, and it goes into storage as-is.
 *
 * THE SYNC ID IS NOT TIED TO A WALLET ADDRESS. It is generated at
 * random on the device and is derived from neither the seed phrase nor
 * the address. An "id — address" link would turn a reference service
 * into an "identity — portfolio" registry — exactly the leak the
 * wallet is built against.
 *
 * THE ID IS A BEARER KEY. Whoever knows it can read the ciphertext
 * (useless without the encryption key) and overwrite it. So it must
 * be random: 32 bytes, hex.
 *
 * A REVISION IS REQUIRED ON WRITE. Two devices writing at once would
 * otherwise silently overwrite each other's changes.
 */

/** Sync id: 32 bytes, lowercase. */
const SYNC_ID_PARAMS = {
  type: 'object',
  required: ['syncId'],
  additionalProperties: false,
  properties: {
    syncId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
} as const

interface ISyncIdParams {
  readonly syncId: string
}

interface IPutSettingsBody {
  readonly ciphertext: string
  readonly revision: number
}

/**
 * Request-body schema.
 *
 * `additionalProperties: false` is not cosmetic: an unknown field is
 * rejected, so a buggy client cannot silently pass the service
 * something it must not accept.
 */
function putSettingsSchema(maxCiphertextLength: number) {
  return {
    type: 'object',
    required: ['ciphertext', 'revision'],
    additionalProperties: false,
    properties: {
      ciphertext: {
        type: 'string',
        minLength: 1,
        maxLength: maxCiphertextLength,
        /* Base64 only. The service does not parse the contents, but
           must confirm this is an opaque string, not arbitrary data:
           a storage route must not become a pass-anything route. */
        pattern: '^[A-Za-z0-9+/]+={0,2}$',
      },
      revision: { type: 'integer', minimum: 0 },
    },
  } as const
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  repository: ISettingsRepository,
  config: IServerConfig,
): void {
  /* Base64 ciphertext is about a third longer than the raw bytes. */
  const maxCiphertextLength = Math.floor((config.maxBodyBytes * 3) / 4)

  app.get<{ Params: ISyncIdParams }>(
    '/v1/settings/:syncId',
    { schema: { params: SYNC_ID_PARAMS } },
    async (request, reply) => {
      const record = await repository.get(request.params.syncId)

      if (record === null) {
        throw new NotFoundError('Settings with this identifier were not found.')
      }

      /* The response is cached by neither the browser nor intermediaries:
         these are one user's data, even if encrypted. */
      void reply.header('cache-control', 'no-store')

      return {
        ciphertext: record.ciphertext,
        revision: record.revision,
        updatedAt: record.updatedAt.toISOString(),
      }
    },
  )

  app.put<{ Params: ISyncIdParams; Body: IPutSettingsBody }>(
    '/v1/settings/:syncId',
    { schema: { params: SYNC_ID_PARAMS, body: putSettingsSchema(maxCiphertextLength) } },
    async (request, reply) => {
      const record = await repository.put(
        request.params.syncId,
        request.body.ciphertext,
        request.body.revision,
      )

      void reply.header('cache-control', 'no-store')

      return {
        ciphertext: record.ciphertext,
        revision: record.revision,
        updatedAt: record.updatedAt.toISOString(),
      }
    },
  )

  app.delete<{ Params: ISyncIdParams }>(
    '/v1/settings/:syncId',
    { schema: { params: SYNC_ID_PARAMS } },
    async (request, reply) => {
      await repository.remove(request.params.syncId)

      /* Deleting a missing record is not an error: otherwise the
         response would tell someone guessing the id whether a
         record exists. */
      void reply.status(204).header('cache-control', 'no-store')

      return null
    },
  )
}
