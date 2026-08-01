import type { FastifyInstance } from 'fastify'

import type { IServerConfig } from '../config.ts'
import { NotFoundError } from '../lib/errors.ts'
import type { ISettingsRepository } from '../settings/contracts.ts'

/**
 * Синхронизация настроек пользователя.
 *
 * СЕРВИС ХРАНИТ ШИФРОТЕКСТ И НЕ УМЕЕТ ЕГО ПРОЧИТАТЬ. Ключ выводится
 * на устройстве; в коде сервиса нет ни расшифровки, ни места, куда
 * такой ключ можно было бы передать. Проверить это можно чтением: тело
 * запроса — одна строка, и она уходит в хранилище как есть.
 *
 * ИДЕНТИФИКАТОР СИНХРОНИЗАЦИИ НЕ СВЯЗАН С АДРЕСОМ КОШЕЛЬКА. Он
 * порождается на устройстве случайно и не выводится ни из seed-фразы,
 * ни из адреса. Связь «идентификатор — адрес» превратила бы справочный
 * сервис в реестр «личность — портфель» — ровно ту утечку, против
 * которой выстроен весь кошелёк.
 *
 * ИДЕНТИФИКАТОР — КЛЮЧ-ПРЕДЪЯВИТЕЛЬ. Кто его знает, тот может прочитать
 * шифротекст (бесполезный без ключа шифрования) и перезаписать его.
 * Поэтому он обязан быть случайным: 32 байта, шестнадцатеричная запись.
 *
 * НОМЕР ВЕРСИИ ОБЯЗАТЕЛЕН ПРИ ЗАПИСИ. Два устройства, писавшие
 * одновременно, иначе затёрли бы изменения друг друга молча.
 */

/** Идентификатор синхронизации: 32 байта в нижнем регистре. */
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
 * Схема тела запроса.
 *
 * `additionalProperties: false` здесь не косметика: неизвестное поле
 * отвергается, и клиент с ошибкой не сможет незаметно передать сервису
 * то, чего тот принимать не должен.
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
        /* Только base64. Сервис не разбирает содержимое, но обязан
           убедиться, что это непрозрачная строка, а не произвольные
           данные: маршрут хранения не должен становиться маршрутом
           передачи чего угодно. */
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
  /* Шифротекст в base64 длиннее исходных данных примерно на треть. */
  const maxCiphertextLength = Math.floor((config.maxBodyBytes * 3) / 4)

  app.get<{ Params: ISyncIdParams }>(
    '/v1/settings/:syncId',
    { schema: { params: SYNC_ID_PARAMS } },
    async (request, reply) => {
      const record = await repository.get(request.params.syncId)

      if (record === null) {
        throw new NotFoundError('Настройки с таким идентификатором не найдены.')
      }

      /* Ответ не кэшируется ни браузером, ни посредниками: это данные
         конкретного пользователя, пусть и зашифрованные. */
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

      /* Удаление отсутствующей записи — не ошибка: иначе ответ сообщал бы,
         существует ли запись с таким идентификатором, тому, кто его
         подбирает. */
      void reply.status(204).header('cache-control', 'no-store')

      return null
    },
  )
}
