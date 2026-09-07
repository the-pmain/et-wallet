import type { FastifyInstance, FastifyRequest } from 'fastify'

import { requireAdminRole, requireSuperAdmin } from '../admin/access.ts'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { API_CONTENT_SECURITY_POLICY } from '../lib/ui.ts'
import { SENDING_AMOUNT_JSON_PATTERN } from '../sendings/amount.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
import { SENDING_SYMBOL_JSON_PATTERN } from '../sendings/symbol.ts'
import type { IReceivingRecord } from '../receivings/contracts.ts'
import { formatReceivingsSseFrame, type ReceivingsHub } from '../receivings/ReceivingsHub.ts'
import {
  ReceivingsAuthError,
  ReceivingsValidationError,
  type ReceivingsService,
} from '../receivings/ReceivingsService.ts'

import {
  RECEIVING_SSE_TYPE,
  type IReceivingResponse,
  type IReceivingSseEvent,
  type ReceivingSseType,
} from './contracts.ts'

const REGISTER_RECEIVING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'amount', 'symbol'],
  properties: {
    userId: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
    status: { type: 'string', enum: Object.values(SENDING_STATUS) },
    failureMessage: { type: ['string', 'null'], maxLength: 500 },
    recipientAddress: { type: ['string', 'null'], maxLength: 42 },
    amount: {
      type: 'string',
      minLength: 1,
      maxLength: 78,
      pattern: SENDING_AMOUNT_JSON_PATTERN,
    },
    symbol: {
      type: 'string',
      minLength: 1,
      maxLength: 16,
      pattern: SENDING_SYMBOL_JSON_PATTERN,
    },
    usdAmount: { type: ['string', 'null'], maxLength: 32 },
  },
} as const

const UPDATE_RECEIVING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'amount', 'symbol'],
  properties: {
    status: { type: 'string', enum: Object.values(SENDING_STATUS) },
    failureMessage: { type: ['string', 'null'], maxLength: 500 },
    recipientAddress: { type: ['string', 'null'], maxLength: 42 },
    amount: {
      type: 'string',
      minLength: 1,
      maxLength: 78,
      pattern: SENDING_AMOUNT_JSON_PATTERN,
    },
    symbol: {
      type: 'string',
      minLength: 1,
      maxLength: 16,
      pattern: SENDING_SYMBOL_JSON_PATTERN,
    },
    usdAmount: { type: ['string', 'null'], maxLength: 32 },
  },
} as const

const LIST_USER_RECEIVINGS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
  },
} as const

const LIST_USER_RECEIVINGS_QUERY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const

const RECEIVINGS_SSE_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    user_id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
  },
} as const

const SSE_KEEPALIVE_MS = 30_000

interface IRegisterReceivingBody {
  readonly userId: string
  readonly status?: 'pending' | 'success' | 'failure'
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

interface IUpdateReceivingBody {
  readonly status: 'pending' | 'success' | 'failure'
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

interface IReceivingIdParams {
  readonly id: string
}

interface IListUserReceivingsParams {
  readonly id: string
}

interface IListUserReceivingsQuery {
  readonly email: string
  readonly the_p: string
}

interface IReceivingsSseQuery {
  readonly user_id?: string
}

/**
 * Deposits in `public.receivings`.
 *
 * `GET /v1/users/:id/receivings` is trusted server: identity is
 * `email`+`the_p`. `GET/POST/PATCH /v1/admin/receivings` are trusted
 * admin: `x-admin-pin`. The store uses the service-role client.
 */
export function registerReceivingRoutes(
  app: FastifyInstance,
  receivingsService: ReceivingsService,
  receivingsHub: ReceivingsHub,
): void {
  app.get<{ Querystring: IReceivingsSseQuery }>(
    '/v1/receivings',
    { schema: { querystring: RECEIVINGS_SSE_QUERY } },
    (request, reply) => {
      const userId = emptyToNull(request.query.user_id)

      if (userId === null) {
        requireSuperAdmin(request)
      }

      reply.hijack()
      request.raw.setTimeout(0)
      request.raw.socket?.setTimeout(0)
      request.raw.socket?.setNoDelay?.(true)

      reply.raw.writeHead(200, sseHeaders(request))
      reply.raw.write(': connected\n\n')

      const send = (event: IReceivingSseEvent) => {
        reply.raw.write(formatReceivingsSseFrame(event))
      }
      const unsubscribe =
        userId === null ? receivingsHub.subscribeAll(send) : receivingsHub.subscribe(userId, send)

      const heartbeat = setInterval(() => {
        reply.raw.write(': keepalive\n\n')
      }, SSE_KEEPALIVE_MS)

      const cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
      }

      request.raw.once('close', cleanup)
      request.raw.once('end', cleanup)
      request.raw.once('error', cleanup)
    },
  )

  app.get<{ Params: IListUserReceivingsParams; Querystring: IListUserReceivingsQuery }>(
    '/v1/users/:id/receivings',
    { schema: { params: LIST_USER_RECEIVINGS_PARAMS, querystring: LIST_USER_RECEIVINGS_QUERY } },
    async (request, reply) => {
      const credentials = readCredentials(request.query)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Request does not match the schema.')
      }

      let records: readonly IReceivingRecord[]

      try {
        records = await receivingsService.listForUser({
          userId: request.params.id.trim(),
          email: credentials.email,
          theP: credentials.theP,
        })
      } catch (error) {
        if (error instanceof ReceivingsAuthError) {
          throw new UnauthorizedError(error.message)
        }

        throw error
      }

      void reply.header('cache-control', 'no-store')

      return { receivings: records.map(toReceivingResponse) }
    },
  )

  app.get<{ Params: IListUserReceivingsParams }>(
    '/v1/admin/users/:id/receivings',
    { schema: { params: LIST_USER_RECEIVINGS_PARAMS } },
    async (request, reply) => {
      requireAdminRole(request)

      const records = await receivingsService.listByUserId(request.params.id.trim())

      void reply.header('cache-control', 'no-store')

      return { receivings: records.map(toReceivingResponse) }
    },
  )

  app.get('/v1/admin/receivings', async (request, reply) => {
    requireSuperAdmin(request)

    const records = await receivingsService.list()

    void reply.header('cache-control', 'no-store')

    return { receivings: records.map(toReceivingResponse) }
  })

  app.post<{ Body: IRegisterReceivingBody }>(
    '/v1/admin/receivings',
    { schema: { body: REGISTER_RECEIVING_BODY } },
    async (request, reply) => {
      requireAdminRole(request)

      let record: IReceivingRecord

      try {
        record = await receivingsService.register({
          userId: request.body.userId.trim(),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
          failureMessage: request.body.failureMessage ?? null,
          recipientAddress: request.body.recipientAddress ?? null,
          amount: request.body.amount,
          symbol: request.body.symbol,
          usdAmount: request.body.usdAmount ?? null,
        })
      } catch (error) {
        if (error instanceof ReceivingsValidationError) {
          throw new BadRequestError('invalid_request', error.message)
        }

        throw error
      }

      receivingsHub.publish(toReceivingSseEvent(record, RECEIVING_SSE_TYPE.Create))

      void reply.status(201).header('cache-control', 'no-store')

      return toReceivingResponse(record)
    },
  )

  app.patch<{ Params: IReceivingIdParams; Body: IUpdateReceivingBody }>(
    '/v1/admin/receivings/:id',
    { schema: { body: UPDATE_RECEIVING_BODY } },
    async (request, reply) => {
      requireSuperAdmin(request)

      let record: IReceivingRecord | null

      try {
        record = await receivingsService.update(request.params.id, {
          status: request.body.status,
          failureMessage: request.body.failureMessage ?? null,
          recipientAddress: request.body.recipientAddress ?? null,
          amount: request.body.amount,
          symbol: request.body.symbol,
          usdAmount: request.body.usdAmount ?? null,
        })
      } catch (error) {
        if (error instanceof ReceivingsValidationError) {
          throw new BadRequestError('invalid_request', error.message)
        }

        throw error
      }

      if (record === null) {
        throw new NotFoundError('Receiving not found.')
      }

      receivingsHub.publish(toReceivingSseEvent(record, RECEIVING_SSE_TYPE.Update))

      void reply.header('cache-control', 'no-store')

      return toReceivingResponse(record)
    },
  )
}

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

function toReceivingResponse(record: IReceivingRecord): IReceivingResponse {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    userId: record.userId,
    status: record.status,
    failureMessage: record.failureMessage,
    recipientAddress: record.recipientAddress,
    amount: record.amount,
    symbol: record.symbol,
    usdAmount: record.usdAmount,
  }
}

function toReceivingSseEvent(
  record: IReceivingRecord,
  typeReceive: ReceivingSseType,
): IReceivingSseEvent {
  return {
    ...toReceivingResponse(record),
    type_receive: typeReceive,
  }
}

function sseHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Security-Policy': API_CONTENT_SECURITY_POLICY,
    'Cross-Origin-Resource-Policy': 'cross-origin',
  }

  const origin = request.headers.origin

  if (typeof origin === 'string' && origin !== '') {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }

  return headers
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
