import type { FastifyInstance } from 'fastify'

import { requireAdminRole, requireSuperAdmin } from '../admin/access.ts'
import { resolveAdminRole } from '../admin/pin.ts'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { readAssetsPayload, sanitizeAssets } from '../users/assets.ts'
import type { IUpdateUserInput, IUserRecord, IUsersRepository } from '../users/contracts.ts'
import { readWalletsPayload } from '../users/wallets.ts'
import type { IUserResponse } from './contracts.ts'

/**
 * Admin cabinet.
 *
 * Cabinet PIN comes from `ADMIN_PIN` (read) and `SUPER_ADMIN_PIN`
 * (write) in the environment. The client presents it in
 * `POST /v1/admin/auth` and then in `x-admin-pin`. Column `the_p`
 * is not in responses: it can only be replaced.
 *
 * `/v1/admin/users` routes are trusted admin: the PIN is checked on
 * the server, then the service-role client reads `public.users`.
 * A `role` field in the body is not proof of rights.
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
        throw new UnauthorizedError('Invalid credentials.')
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
      throw new NotFoundError('User not found.')
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
        throw new BadRequestError('invalid_request', 'The request does not match the schema.')
      }

      const record = await users.update(request.params.id, patch)

      if (record === null) {
        throw new NotFoundError('User not found.')
      }

      void reply.header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )

  app.delete<{ Params: IUserIdParams }>('/v1/admin/users/:id', async (request, reply) => {
    requireSuperAdmin(request)

    const removed = await users.remove(request.params.id)

    if (!removed) {
      throw new NotFoundError('User not found.')
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
