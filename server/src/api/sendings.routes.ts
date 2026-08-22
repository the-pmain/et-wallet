import type { FastifyInstance } from 'fastify'

import { BadRequestError, UnauthorizedError } from '../lib/errors.ts'
import { SENDING_AMOUNT_JSON_PATTERN } from '../sendings/amount.ts'
import { SendingsAuthError, SendingsService } from '../sendings/SendingsService.ts'
import type { ISendingRecord } from '../sendings/contracts.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
import type { ISendingResponse } from './contracts.ts'

const REGISTER_SENDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['user_id', 'email', 'the_p', 'recipient_address', 'amount'],
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
  },
} as const

interface IRegisterSendingBody {
  readonly user_id: string
  readonly email: string
  readonly the_p: string
  readonly recipient_address: string
  readonly amount: string
}

export function registerSendingRoutes(
  app: FastifyInstance,
  sendingsService: SendingsService,
): void {
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
        })
      } catch (error) {
        if (error instanceof SendingsAuthError) {
          throw new UnauthorizedError(error.message)
        }

        throw error
      }

      void reply
        .status(record.status === SENDING_STATUS.Success ? 201 : 200)
        .header('cache-control', 'no-store')

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
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
