import type { FastifyInstance } from 'fastify'

import type { IUsersRepository } from '../users/contracts.ts'

/**
 * Создание пользователя в таблице `public.users`.
 *
 * Это не вход: сервис не сверяет `the_p`, только записывает строку.
 */

const CREATE_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    username: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }],
    },
    balance: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
    },
    the_p: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: 256 }, { type: 'null' }],
    },
  },
} as const

interface ICreateUserBody {
  readonly username?: string | null
  readonly balance?: string | null
  readonly the_p?: string | null
}

export function registerUserRoutes(app: FastifyInstance, users: IUsersRepository): void {
  app.post<{ Body: ICreateUserBody }>(
    '/v1/users',
    { schema: { body: CREATE_USER_BODY } },
    async (request, reply) => {
      const record = await users.create({
        username: emptyToNull(request.body.username),
        balance: emptyToNull(request.body.balance) ?? '0',
        theP: emptyToNull(request.body.the_p),
      })

      void reply.status(201).header('cache-control', 'no-store')

      return {
        id: record.id,
        username: record.username,
        balance: record.balance,
        createdAt: record.createdAt.toISOString(),
      }
    },
  )
}

/** Пустая строка для колонки `text null` — это отсутствие значения. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
