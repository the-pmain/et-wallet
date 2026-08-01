import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'

/**
 * Проверка версии приложения.
 *
 * ОТВЕТ НЕ СОДЕРЖИТ АДРЕСА ЗАГРУЗКИ. Сервис, сообщающий «скачайте
 * обновление отсюда», — готовый способ увести пользователя
 * на поддельный установщик: достаточно однажды подменить строку
 * в ответе. Адрес магазина расширений зашит в клиенте.
 *
 * ЭТО ЗАЯВЛЕНИЕ О ПОДДЕРЖКЕ, А НЕ ВЫКЛЮЧАТЕЛЬ. Некастодиальный кошелёк
 * обязан работать, даже когда его сервис недоступен или враждебен.
 * Клиент показывает предупреждение и продолжает работать.
 *
 * ВЕРСИЯ КЛИЕНТА НЕОБЯЗАТЕЛЬНА. Без неё сравнивать не с чем, и признаки
 * поддержки возвращаются как `null`: «не знаем» нельзя подменять
 * ни на «всё в порядке», ни на «пора обновляться».
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
