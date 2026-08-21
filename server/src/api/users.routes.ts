import type { FastifyInstance } from 'fastify'

import { BadRequestError, UnauthorizedError } from '../lib/errors.ts'
import {
  createStartingAssets,
  readAssetsPayload,
  sanitizeAssets,
  withZeroTokenBalances,
} from '../users/assets.ts'
import type { IUserRecord, IUsersRepository } from '../users/contracts.ts'
import {
  INITIAL_WALLET_VALUE,
  isWalletKey,
  readWalletValue,
  readWalletsPayload,
  withZeroBalances,
} from '../users/wallets.ts'
import type { IUserResponse, IWalletEntryResponse } from './contracts.ts'

/**
 * Пользователи в таблице `public.users`.
 *
 * Колонки входа: `email` и `the_p`. Поле `username` схема не принимает.
 * `POST /v1/users` — новая строка. Тело может содержать `assets`;
 * сервер оставляет только остатки, обнуляет `balance` у каждого токена
 * и отбрасывает `priceUsd` / `valueUsd`. Без поля — стартовая витрина
 * из одного ETH.
 * `POST /v1/users/auth` — сверка `email` и `the_p`.
 * `POST /v1/users/wallets` — ещё один `{ key, value }` в уже существующий список.
 * Запрос не по схеме — 400, вход не выдаётся.
 */

const WALLET_ENTRY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

const ASSET_TOKEN_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['chainId', 'standard', 'address', 'symbol', 'name', 'decimals', 'balance', 'isVerified'],
  properties: {
    chainId: { type: 'string', minLength: 1, maxLength: 16 },
    standard: { type: 'string', enum: ['native', 'ERC-20'] },
    address: { type: ['string', 'null'] },
    symbol: { type: 'string', minLength: 1, maxLength: 32 },
    name: { type: 'string', minLength: 1, maxLength: 128 },
    decimals: { type: 'integer', minimum: 0, maximum: 36 },
    balance: { type: 'string', minLength: 1, maxLength: 78 },
    isVerified: { type: 'boolean' },
  },
} as const

const ASSETS_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['quoteCurrency', 'updatedAt', 'tokens'],
  properties: {
    quoteCurrency: { type: 'string', const: 'USD' },
    updatedAt: { type: 'string', minLength: 1 },
    tokens: { type: 'array', maxItems: 64, items: ASSET_TOKEN_BODY },
  },
} as const

const CREATE_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    balance: { type: 'string', minLength: 1, maxLength: 64 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    wallets: {
      oneOf: [WALLET_ENTRY_BODY, { type: 'array', items: WALLET_ENTRY_BODY }],
    },
    assets: ASSETS_BODY,
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

const ADD_WALLET_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p', 'key', 'value'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

interface ICreateUserBody {
  readonly email: string
  readonly balance?: string
  readonly the_p: string
  readonly wallets?: IWalletEntryResponse | readonly IWalletEntryResponse[]
  readonly assets?: unknown
}

interface IAuthUserBody {
  readonly email: string
  readonly the_p: string
}

interface IAddWalletBody {
  readonly email: string
  readonly the_p: string
  readonly key: string
  readonly value: string
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

  app.post<{ Body: IAddWalletBody }>(
    '/v1/users/wallets',
    { schema: { body: ADD_WALLET_BODY } },
    async (request, reply) => {
      const credentials = readCredentials(request.body)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Запрос не соответствует схеме.')
      }

      if (!isWalletKey(request.body.key)) {
        throw new BadRequestError('invalid_request', 'Ключ должен быть адресом EVM.')
      }

      if (readWalletValue(request.body.value) === null) {
        throw new BadRequestError('invalid_request', 'Значение кошелька непригодно.')
      }

      const record = await users.addWallet({
        email: credentials.email,
        theP: credentials.theP,
        key: request.body.key,
        value: INITIAL_WALLET_VALUE,
      })

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

      const wallets = readWalletsPayload(request.body.wallets)

      if (wallets === null) {
        throw new BadRequestError('invalid_request', 'Список кошельков непригоден.')
      }

      const record = await users.create({
        email: credentials.email,
        balance: '0',
        theP: credentials.theP,
        wallets: withZeroBalances(wallets),
        assets: readCreateAssets(request.body.assets),
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

/** Витрина из тела создания: лишние поля уже отвергла схема, остатки обнуляются. */
function readCreateAssets(value: unknown): ReturnType<typeof createStartingAssets> {
  if (value === undefined) {
    return createStartingAssets()
  }

  const parsed = readAssetsPayload(value)

  if (parsed === null) {
    throw new BadRequestError('invalid_request', 'Витрина активов непригодна.')
  }

  return withZeroTokenBalances(sanitizeAssets(parsed))
}

/** Публичный снимок записи: колонка `the_p` не входит. */
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

/** Пустая строка для колонки `text null` — это отсутствие значения. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
