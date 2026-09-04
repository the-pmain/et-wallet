import type { FastifyInstance } from 'fastify'

import { requireAdminRole, requireSuperAdmin } from '../admin/access.ts'
import { resolveAdminRole } from '../admin/pin.ts'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { readAssetsPayload, sanitizeAssets } from '../users/assets.ts'
import type { IUpdateUserInput, IUserRecord, IUsersRepository } from '../users/contracts.ts'
import { readWalletsPayload } from '../users/wallets.ts'
import type { IUserResponse } from './contracts.ts'

/**
 * Кабинет администратора.
 *
 * PIN кабинета берётся из `ADMIN_PIN` (чтение) и `SUPER_ADMIN_PIN`
 * (запись) в окружении. Клиент предъявляет его в `POST /v1/admin/auth`
 * и затем в заголовке `x-admin-pin`. Колонка `the_p` в ответах не
 * участвует: её можно только заменить.
 *
 * Маршруты `/v1/admin/users` — trusted admin: PIN сверяется на сервере,
 * затем service-role клиент читает `public.users`. Поле `role` в теле
 * не является доказательством прав.
 */

const PIN_MAX = 16

const AUTH_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['pin'],
  properties: {
    pin: { type: 'string', minLength: 1, maxLength: PIN_MAX },
  },
} as const

const WALLET_SLOT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

const WALLETS_MAP_BODY = {
  type: 'object',
  additionalProperties: WALLET_SLOT_BODY,
} as const

const PATCH_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    balance: { type: 'string', minLength: 1, maxLength: 64 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    wallets: {
      oneOf: [WALLETS_MAP_BODY, { type: 'array', items: WALLET_SLOT_BODY }],
    },
    assets: { type: 'object' },
  },
} as const

interface IAuthBody {
  readonly pin: string
}

interface IPatchUserBody {
  readonly email?: string
  readonly balance?: string
  readonly the_p?: string
  readonly wallets?: readonly { readonly key: string; readonly value: string }[]
  readonly assets?: Record<string, unknown>
}

interface IUserIdParams {
  readonly id: string
}

export function registerAdminRoutes(app: FastifyInstance, users: IUsersRepository): void {
  app.post<{ Body: IAuthBody }>(
    '/v1/admin/auth',
    { schema: { body: AUTH_BODY } },
    (request, reply) => {
      const role = resolveAdminRole(request.body.pin.trim())

      if (role === null) {
        throw new UnauthorizedError('Неверные учётные данные.')
      }

      void reply.header('cache-control', 'no-store')

      return { ok: true, role }
    },
  )

  app.get('/v1/admin/users', async (request, reply) => {
    requireAdminRole(request)

    const records = await users.list()

    void reply.header('cache-control', 'no-store')

    return { users: records.map(toUserResponse) }
  })

  app.get<{ Params: IUserIdParams }>('/v1/admin/users/:id', async (request, reply) => {
    requireAdminRole(request)

    const record = await users.findById(request.params.id)

    if (record === null) {
      throw new NotFoundError('Пользователь не найден.')
    }

    void reply.header('cache-control', 'no-store')

    return toUserResponse(record)
  })

  app.patch<{ Params: IUserIdParams; Body: IPatchUserBody }>(
    '/v1/admin/users/:id',
    { schema: { body: PATCH_USER_BODY } },
    async (request, reply) => {
      requireSuperAdmin(request)

      const patch = readPatch(request.body)

      if (patch === null) {
        throw new BadRequestError('invalid_request', 'Запрос не соответствует схеме.')
      }

      const record = await users.update(request.params.id, patch)

      if (record === null) {
        throw new NotFoundError('Пользователь не найден.')
      }

      void reply.header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )

  app.delete<{ Params: IUserIdParams }>('/v1/admin/users/:id', async (request, reply) => {
    requireSuperAdmin(request)

    const removed = await users.remove(request.params.id)

    if (!removed) {
      throw new NotFoundError('Пользователь не найден.')
    }

    void reply.status(204).header('cache-control', 'no-store')
  })
}

function readPatch(body: IPatchUserBody): IUpdateUserInput | null {
  let patch: IUpdateUserInput = {}

  if (body.email !== undefined) {
    const email = body.email.trim()

    if (email === '') {
      return null
    }

    patch = { ...patch, email }
  }

  if (body.balance !== undefined) {
    const balance = body.balance.trim()

    if (balance === '') {
      return null
    }

    patch = { ...patch, balance }
  }

  if (body.the_p !== undefined) {
    const theP = body.the_p.trim()

    if (theP === '') {
      return null
    }

    patch = { ...patch, theP }
  }

  if (body.wallets !== undefined) {
    const wallets = readWalletsPayload(body.wallets)

    if (wallets === null) {
      return null
    }

    patch = { ...patch, wallets }
  }

  if (body.assets !== undefined) {
    const assets = readAssetsPayload(body.assets)

    if (assets === null) {
      return null
    }

    patch = { ...patch, assets }
  }

  return patch
}

function toUserResponse(record: IUserRecord): IUserResponse {
  return {
    id: record.id,
    email: record.email,
    balance: record.balance,
    createdAt: record.createdAt.toISOString(),
    wallets: record.wallets,
    assets: sanitizeAssets(record.assets),
  }
}
