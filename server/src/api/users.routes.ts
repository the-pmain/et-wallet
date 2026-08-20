import type { FastifyInstance } from 'fastify'

import { BadRequestError, UnauthorizedError } from '../lib/errors.ts'
import type { IUserRecord, IUsersRepository } from '../users/contracts.ts'

import type { IUserResponse } from './contracts.ts'

/**
 * Пользователи в таблице `public.users`.
 *
 * Колонки входа: `email` и `the_p`. Поле `username` схема не принимает.
 * `POST /v1/users` — новая строка. `POST /v1/users/auth` — сверка
 * `email` и `the_p`. Запрос не по схеме — 400, вход не выдаётся.
 */

const CREATE_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    balance: { type: 'string', minLength: 1, maxLength: 64 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const

const AUTH_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const

interface ICreateUserBody {
  readonly email: string
  readonly balance?: string
  readonly the_p: string
}

interface IAuthUserBody {
  readonly email: string
  readonly the_p: string
}

export function registerUserRoutes(app: FastifyInstance, users: IUsersRepository): void {
  app.post<{ Body: IAuthUserBody }>(
    '/v1/users/auth',
    { schema: { body: AUTH_USER_BODY } },
    async (request, reply) => {
      const credentials = readCredentials(request.body)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Запрос не соответствует схеме.')
      }

      const record = await users.findByCredentials(credentials)

      if (record === null) {
        throw new UnauthorizedError('Неверные учётные данные.')
      }

      void reply.header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )

  app.post<{ Body: ICreateUserBody }>(
    '/v1/users',
    { schema: { body: CREATE_USER_BODY } },
    async (request, reply) => {
      const credentials = readCredentials(request.body)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Запрос не соответствует схеме.')
      }

      const record = await users.create({
        email: credentials.email,
        balance: emptyToNull(request.body.balance) ?? '0',
        theP: credentials.theP,
      })

      void reply.status(201).header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )
}

/** Почта и `the_p` после обрезки пробелов. Пустое значение — не вход. */
function readCredentials(body: { readonly email: string; readonly the_p: string }): {
  readonly email: string
  readonly theP: string
} | null {
  const email = emptyToNull(body.email)
  const theP = emptyToNull(body.the_p)

  if (email === null || theP === null) {
    return null
  }

  return { email, theP }
}

/** Публичный снимок записи: колонка `the_p` в ответ не входит. */
function toUserResponse(record: IUserRecord): IUserResponse {
  return {
    id: record.id,
    email: record.email,
    balance: record.balance,
    createdAt: record.createdAt.toISOString(),
  }
}

/** Пустая строка для колонки `text null` — это отсутствие значения. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
