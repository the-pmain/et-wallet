import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'
import type { IServerConfig } from '../config.ts'
import { BadRequestError, NotFoundError } from '../lib/errors.ts'

/**
 * Каталоги: сети, рекомендуемые RPC-адреса, рекомендуемые токены.
 *
 * ВСЕ МАРШРУТЫ ЧИТАЮЩИЕ И ОБЕЗЛИЧЕННЫЕ. Ни один не принимает адрес
 * кошелька — ни в пути, ни в строке запроса. Персонализация каталога
 * по адресу превратила бы справочный сервис в наблюдателя за портфелем:
 * он узнавал бы, какие адреса принадлежат одному пользователю, просто
 * из того, что их спрашивают вместе.
 */

/** Идентификатор сети в пути: десятичное число без знака. */
const CHAIN_ID_PARAMS = {
  type: 'object',
  required: ['chainId'],
  additionalProperties: false,
  properties: {
    /* Длина ограничена: `BigInt` примет строку любой длины и потратит
       на неё время, а идентификаторов такой величины не существует. */
    chainId: { type: 'string', pattern: '^[0-9]{1,20}$' },
  },
} as const

interface IChainIdParams {
  readonly chainId: string
}

/**
 * Разбирает идентификатор сети.
 *
 * Схема уже отсеяла всё, кроме цифр, но ведущие нули дали бы два
 * разных написания одной сети — и два разных ключа кэша у посредников.
 */
function parseChainId(raw: string): bigint {
  const value = BigInt(raw)

  if (value <= 0n) {
    throw new BadRequestError('invalid_chain_id', 'Идентификатор сети должен быть положительным.')
  }

  if (value.toString() !== raw) {
    throw new BadRequestError(
      'invalid_chain_id',
      'Идентификатор сети записывается без ведущих нулей.',
    )
  }

  return value
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  catalog: CatalogService,
  config: IServerConfig,
): void {
  /* Каталог меняется выпуском сервиса, а не поминутно: разрешить кэш
     значит убрать лишние обращения, каждое из которых раскрывает
     оператору сервиса факт работы пользователя. */
  const cacheControl = `public, max-age=${String(config.catalogCacheSeconds)}`

  app.get('/v1/networks', (_request, reply) => {
    void reply.header('cache-control', cacheControl)

    return { networks: catalog.listNetworks() }
  })

  app.get<{ Params: IChainIdParams }>(
    '/v1/networks/:chainId/rpc',
    { schema: { params: CHAIN_ID_PARAMS } },
    (request, reply) => {
      const chainId = parseChainId(request.params.chainId)

      if (!catalog.hasNetwork(chainId)) {
        throw new NotFoundError(`Сеть ${chainId.toString()} отсутствует в каталоге.`)
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

      /* Неизвестная сеть и сеть без подтверждённых рекомендаций — разные
         ответы. Пустой список для несуществующей сети читался бы как
         «токенов нет», то есть как утверждение о том, чего мы не знаем. */
      if (!catalog.hasNetwork(chainId)) {
        throw new NotFoundError(`Сеть ${chainId.toString()} отсутствует в каталоге.`)
      }

      void reply.header('cache-control', cacheControl)

      return { tokens: catalog.listTokens(chainId) }
    },
  )
}
