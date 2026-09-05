import type { FastifyInstance, FastifyRequest } from 'fastify'

import { requireSuperAdmin } from '../admin/access.ts'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { API_CONTENT_SECURITY_POLICY } from '../lib/ui.ts'
import { SENDING_AMOUNT_JSON_PATTERN } from '../sendings/amount.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
import { formatSendingsSseFrame, type SendingsHub } from '../sendings/SendingsHub.ts'
import { SENDING_SYMBOL_JSON_PATTERN } from '../sendings/symbol.ts'
import {
  SendingsAuthError,
  SendingsValidationError,
  type SendingsService,
} from '../sendings/SendingsService.ts'
import type { ISendingRecord } from '../sendings/contracts.ts'
import {
  SENDING_SSE_TYPE,
  type ISendingResponse,
  type ISendingSseEvent,
  type SendingSseType,
} from './contracts.ts'

const REGISTER_SENDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['user_id', 'email', 'the_p', 'recipient_address', 'amount', 'symbol'],
  properties: {
    user_id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    recipient_address: { type: 'string', minLength: 42, maxLength: 42 },
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
  },
} as const

const UPDATE_SENDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'recipientAddress', 'amount', 'symbol'],
  properties: {
    status: { type: 'string', enum: Object.values(SENDING_STATUS) },
    failureMessage: { type: ['string', 'null'], maxLength: 500 },
    recipientAddress: { type: 'string', minLength: 42, maxLength: 42 },
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
  },
} as const

const LIST_USER_SENDINGS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
  },
} as const

const LIST_USER_SENDINGS_QUERY = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'the_p'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const

const SENDINGS_SSE_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    user_id: { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\d+$' },
  },
} as const

const SSE_KEEPALIVE_MS = 30_000

interface IRegisterSendingBody {
  readonly user_id: string
  readonly email: string
  readonly the_p: string
  readonly recipient_address: string
  readonly amount: string
  readonly symbol: string
}

interface IUpdateSendingBody {
  readonly status: 'pending' | 'success' | 'failure'
  readonly failureMessage?: string | null
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}

interface ISendingIdParams {
  readonly id: string
}

interface IListUserSendingsParams {
  readonly id: string
}

interface IListUserSendingsQuery {
  readonly email: string
  readonly the_p: string
}

interface ISendingsSseQuery {
  readonly user_id?: string
}

/**
 * Transfers in `public.sendings`.
 *
 * `POST /v1/users/sendings` and `GET /v1/users/:id/sendings` are trusted
 * server: identity is `email`+`the_p`, `user_id` must match.
 * `GET/PATCH /v1/admin/sendings` are trusted admin: `x-admin-pin`.
 * The store uses the service-role client. A user-scoped JWT does not
 * fit: `user_id` is `users.id`, not `auth.uid()`.
 * `GET /v1/sendings` is an in-process SSE stream; it does not read the table.
 */
export function registerSendingRoutes(
  app: FastifyInstance,
  sendingsService: SendingsService,
  sendingsHub: SendingsHub,
): void {
  app.get<{ Querystring: ISendingsSseQuery }>(
    '/v1/sendings',
    { schema: { querystring: SENDINGS_SSE_QUERY } },
    (request, reply) => {
      /* No user_id — cabinet stream: every new record. With a filter —
         only that user's transfers on the send screen. */
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

      const send = (event: ISendingSseEvent) => {
        reply.raw.write(formatSendingsSseFrame(event))
      }
      const unsubscribe =
        userId === null ? sendingsHub.subscribeAll(send) : sendingsHub.subscribe(userId, send)

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

  app.get<{ Params: IListUserSendingsParams; Querystring: IListUserSendingsQuery }>(
    '/v1/users/:id/sendings',
    { schema: { params: LIST_USER_SENDINGS_PARAMS, querystring: LIST_USER_SENDINGS_QUERY } },
    async (request, reply) => {
      const credentials = readCredentials(request.query)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Request does not match the schema.')
      }

      let records: readonly ISendingRecord[]

      try {
        records = await sendingsService.listForUser({
          userId: request.params.id.trim(),
          email: credentials.email,
          theP: credentials.theP,
        })
      } catch (error) {
        if (error instanceof SendingsAuthError) {
          throw new UnauthorizedError(error.message)
        }

        throw error
      }

      void reply.header('cache-control', 'no-store')

      return { sendings: records.map(toSendingResponse) }
    },
  )

  app.get('/v1/admin/sendings', async (request, reply) => {
    requireSuperAdmin(request)

    const records = await sendingsService.list()

    void reply.header('cache-control', 'no-store')

    return { sendings: records.map(toSendingResponse) }
  })

  app.patch<{ Params: ISendingIdParams; Body: IUpdateSendingBody }>(
    '/v1/admin/sendings/:id',
    { schema: { body: UPDATE_SENDING_BODY } },
    async (request, reply) => {
      requireSuperAdmin(request)

      let record: ISendingRecord | null

      try {
        record = await sendingsService.update(request.params.id, {
          status: request.body.status,
          failureMessage: request.body.failureMessage ?? null,
          recipientAddress: request.body.recipientAddress,
          amount: request.body.amount,
          symbol: request.body.symbol,
        })
      } catch (error) {
        if (error instanceof SendingsValidationError) {
          throw new BadRequestError('invalid_request', error.message)
        }

        throw error
      }

      if (record === null) {
        throw new NotFoundError('Sending not found.')
      }

      sendingsHub.publish(toSendingSseEvent(record, SENDING_SSE_TYPE.Update))

      void reply.header('cache-control', 'no-store')

      return toSendingResponse(record)
    },
  )

  app.post<{ Body: IRegisterSendingBody }>(
    '/v1/users/sendings',
    { schema: { body: REGISTER_SENDING_BODY } },
    async (request, reply) => {
      const credentials = readCredentials(request.body)

      if (credentials === null) {
        throw new BadRequestError('invalid_request', 'Request does not match the schema.')
      }

      let record: ISendingRecord

      try {
        record = await sendingsService.register({
          userId: request.body.user_id.trim(),
          email: credentials.email,
          theP: credentials.theP,
          recipientAddress: request.body.recipient_address,
          amount: request.body.amount,
          symbol: request.body.symbol,
        })
      } catch (error) {
        if (error instanceof SendingsAuthError) {
          throw new UnauthorizedError(error.message)
        }

        if (error instanceof SendingsValidationError) {
          throw new BadRequestError('invalid_request', error.message)
        }

        throw error
      }

      sendingsHub.publish(toSendingSseEvent(record, SENDING_SSE_TYPE.Create))

      void reply.status(201).header('cache-control', 'no-store')

      return toSendingResponse(record)
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

function toSendingResponse(record: ISendingRecord): ISendingResponse {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    userId: record.userId,
    status: record.status,
    failureMessage: record.failureMessage,
    recipientAddress: record.recipientAddress,
    amount: record.amount,
    symbol: record.symbol,
  }
}

function toSendingSseEvent(record: ISendingRecord, typeSend: SendingSseType): ISendingSseEvent {
  return {
    ...toSendingResponse(record),
    type_send: typeSend,
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
