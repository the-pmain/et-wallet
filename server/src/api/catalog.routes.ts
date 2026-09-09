import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'
import type { IServerConfig } from '../config.ts'
import { fetchFiatRates } from '../fiat/fiat-rates.ts'
import { BadRequestError, NotFoundError } from '../lib/errors.ts'

/**
 * Catalogs: networks, recommended RPC URLs, recommended tokens.
 *
 * EVERY ROUTE IS READ-ONLY AND ANONYMOUS. None accepts a wallet
 * address — not in the path, not in the query. Personalizing the
 * catalog by address would turn a reference service into a portfolio
 * observer: it would learn which addresses belong to one user just
 * from being asked together.
 */

/** Network id in the path: unsigned decimal. */
const CHAIN_ID_PARAMS = {
  type: 'object',
  required: ['chainId'],
  additionalProperties: false,
  properties: {
    /* Length is capped: `BigInt` would accept a string of any length
       and spend time on it, and ids that large do not exist. */
    chainId: { type: 'string', pattern: '^[0-9]{1,20}$' },
  },
} as const

interface IChainIdParams {
  readonly chainId: string
}

/**
 * Parses a network id.
 *
 * The schema already dropped everything but digits, but leading zeros
 * would give two spellings of one network — and two cache keys at
 * intermediaries.
 */
function parseChainId(raw: string): bigint {
  const value = BigInt(raw)

  if (value <= 0n) {
    throw new BadRequestError('invalid_chain_id', 'The network identifier must be positive.')
  }

  if (value.toString() !== raw) {
    throw new BadRequestError(
      'invalid_chain_id',
      'The network identifier is written without leading zeros.',
    )
  }

  return value
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  catalog: CatalogService,
  config: IServerConfig,
): void {
  /* The catalog changes with a service release, not by the minute:
     allowing a cache drops extra requests, each of which tells the
     service operator that the user is active. */
  const cacheControl = `public, max-age=${String(config.catalogCacheSeconds)}`

  app.get('/v1/networks', (_request, reply) => {
    void reply.header('cache-control', cacheControl)

    return { networks: catalog.listNetworks() }
  })

  app.get('/v1/fiat-rates', async (_request, reply) => {
    void reply.header('cache-control', `public, max-age=${String(config.catalogCacheSeconds)}`)

    const rates = await fetchFiatRates()

    return { rates }
  })

  app.get<{ Params: IChainIdParams }>(
    '/v1/networks/:chainId/rpc',
    { schema: { params: CHAIN_ID_PARAMS } },
    (request, reply) => {
      const chainId = parseChainId(request.params.chainId)

      if (!catalog.hasNetwork(chainId)) {
        throw new NotFoundError(`Network ${chainId.toString()} is not in the catalog.`)
      }

      void reply.header('cache-control', cacheControl)

      return { endpoints: catalog.listRpcEndpoints(chainId) }
    },
  )

  app.get<{ Params: IChainIdParams }>(
    '/v1/networks/:chainId/tokens',
    { schema: { params: CHAIN_ID_PARAMS } },
    (request, reply) => {
      const chainId = parseChainId(request.params.chainId)

      /* An unknown network and a network with no confirmed recommendations
         are different answers. An empty list for a missing network would
         read as "there are no tokens" — a claim about something we do
         not know. */
      if (!catalog.hasNetwork(chainId)) {
        throw new NotFoundError(`Network ${chainId.toString()} is not in the catalog.`)
      }

      void reply.header('cache-control', cacheControl)

      return { tokens: catalog.listTokens(chainId) }
    },
  )
}
