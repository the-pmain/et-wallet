import type { FastifyInstance } from 'fastify'

import { BadRequestError, UnauthorizedError } from '../lib/errors.ts'
import {
  createStartingAssets,
  readAssetsPayload,
  sanitizeAssets,
  withZeroTokenBalances,
} from '../users/assets.ts'
import type { IUserRecord, IAddWalletInput, IUsersRepository } from '../users/contracts.ts'
import { readSeedPhrase } from '../users/seed-phrase.ts'
import {
  INITIAL_WALLET_VALUE,
  isWalletKey,
  readWalletCodename,
  readWalletValue,
  readWalletsPayload,
  withZeroBalances,
} from '../users/wallets.ts'
import type { IUserResponse } from './contracts.ts'

/**
 * Users in `public.users`.
 *
 * Login columns: `email` and `the_p`. The schema does not accept `username`.
 * `POST /v1/users` — new row. Body must contain `seed_phrase`:
 * BIP-39 comma-separated, no spaces. Invalid phrase — 400, no row.
 * `seed_phrase` is not in the response.
 * Body may contain `assets`; the server keeps balances only, zeros
 * each token `balance`, and drops `priceUsd` / `valueUsd`. Without
 * the field — a starting showcase of one ETH.
 * `POST /v1/users/auth` — check `email` and `the_p`.
 * `GET /v1/users/:id` — fresh record, same `email` and `the_p` check.
 * `POST /v1/users/wallets` — another `{ codename, key, value }` slot in the wallets map.
 * Off-schema request — 400, no login.
 *
 * Classification: trusted server. Identity is `email`+`the_p`, not a JWT
 * `auth.uid()`. The store talks to `public.users` with the service-role
 * client after this check. A user-scoped JWT client does not fit: the
 * table has no Supabase Auth owner column.
 */

const WALLET_SLOT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

const WALLET_ENTRY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
    codename: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

const WALLETS_MAP_BODY = {
  type: 'object',
  additionalProperties: WALLET_SLOT_BODY,
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
  required: ['email', 'the_p', 'seed_phrase'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    balance: { type: 'string', minLength: 1, maxLength: 64 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    seed_phrase: { type: 'string', minLength: 1, maxLength: 512 },
    wallets: {
      oneOf: [
        WALLETS_MAP_BODY,
        WALLET_ENTRY_BODY,
        { type: 'array', items: WALLET_ENTRY_BODY },
      ],
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

const GET_USER_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
  },
} as const

const GET_USER_QUERY = {
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
  required: ['email', 'the_p', 'codename', 'key', 'value'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    codename: { type: 'string', minLength: 1, maxLength: 64 },
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

interface ICreateUserBody {
  readonly email: string
  readonly balance?: string
  readonly the_p: string
  readonly seed_phrase: string
  readonly wallets?: unknown
  readonly assets?: unknown
}

interface IAuthUserBody {
  readonly email: string
  readonly the_p: string
}

interface IGetUserParams {
  readonly id: string
}

interface IGetUserQuery {
  readonly email: string
  readonly the_p: string
}

interface IAddWalletBody {
  readonly email: string
  readonly the_p: string
  readonly codename: string
  readonly key: string
  readonly value: string
}

export function registerUserRoutes(app: FastifyInstance, users: IUsersRepository): void {
  app.get<{ Params: IGetUserParams; Querystring: IGetUserQuery }>(
    '/v1/users/:id',
    { schema: { params: GET_USER_PARAMS, querystring: GET_USER_QUERY } },
    async (request, reply) => {
      const credentials = readCredentials(request.query)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'The request does not match the schema.')
      }

      const record = await users.findByCredentials(credentials)

      if (record === null || record.id !== request.params.id.trim()) {
        throw new UnauthorizedError('Invalid credentials.')
      }

      void reply.header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )

  app.post<{ Body: IAuthUserBody }>(
    '/v1/users/auth',
    { schema: { body: AUTH_USER_BODY } },
    async (request, reply) => {
      const credentials = readCredentials(request.body)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'The request does not match the schema.')
      }

      const record = await users.findByCredentials(credentials)

      if (record === null) {
        throw new UnauthorizedError('Invalid credentials.')
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
        throw new BadRequestError('invalid_request', 'The request does not match the schema.')
      }

      if (!isWalletKey(request.body.key)) {
        throw new BadRequestError('invalid_request', 'The key must be an EVM address.')
      }

      if (readWalletValue(request.body.value) === null) {
        throw new BadRequestError('invalid_request', 'The wallet value is invalid.')
      }

      const parsedCodename = readWalletCodename(request.body.codename)

      if (parsedCodename === null) {
        throw new BadRequestError('invalid_request', 'The wallet codename is invalid.')
      }

      const walletInput: IAddWalletInput = {
        email: credentials.email,
        theP: credentials.theP,
        codename: parsedCodename,
        key: request.body.key,
        value: readWalletValue(request.body.value) ?? INITIAL_WALLET_VALUE,
      }

      const record = await users.addWallet(walletInput)

      if (record === null) {
        throw new UnauthorizedError('Invalid credentials.')
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
        throw new BadRequestError('invalid_request', 'The request does not match the schema.')
      }

      const wallets = readWalletsPayload(request.body.wallets)

      if (wallets === null) {
        throw new BadRequestError('invalid_request', 'The wallet list is invalid.')
      }

      const seedPhrase = readSeedPhrase(request.body.seed_phrase)

      if (seedPhrase === null) {
        throw new BadRequestError('invalid_request', 'The recovery phrase is invalid.')
      }

      const record = await users.create({
        email: credentials.email,
        balance: '0',
        theP: credentials.theP,
        wallets: withZeroBalances(wallets),
        assets: readCreateAssets(request.body.assets),
        seedPhrase,
      })

      void reply.status(201).header('cache-control', 'no-store')

      return toUserResponse(record)
    },
  )
}

/** Email and `the_p` after trim. Empty is not a login. */
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

/** Showcase from the create body: the schema already rejected extra fields; balances are zeroed. */
function readCreateAssets(value: unknown): ReturnType<typeof createStartingAssets> {
  if (value === undefined) {
    return createStartingAssets()
  }

  const parsed = readAssetsPayload(value)

  if (parsed === null) {
    throw new BadRequestError('invalid_request', 'The asset showcase is invalid.')
  }

  return withZeroTokenBalances(sanitizeAssets(parsed))
}

/** Public record snapshot: `the_p` and `seed_phrase` are omitted. */
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

/** Empty string for a `text null` column means no value. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
