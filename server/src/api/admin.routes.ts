import type { FastifyInstance, FastifyRequest } from 'fastify'

import { emailManagerPinMatches, pinMatches } from '../admin/pin.ts'
import { isEmailAddress } from '../email/address.ts'
import type { IEmailMessage, IEmailService } from '../email/contracts.ts'
import { htmlToPlainText, isBlankHtml, wrapPlainTextAsHtml } from '../email/plain-text.ts'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { readAssetsPayload, sanitizeAssets } from '../users/assets.ts'
import type { IUpdateUserInput, IUserRecord, IUsersRepository } from '../users/contracts.ts'
import { readWalletsPayload } from '../users/wallets.ts'
import type { IUserResponse } from './contracts.ts'

/**
 * Кабинет администратора.
 *
 * PIN кабинета зашит на сервере. Клиент предъявляет его в
 * `POST /v1/admin/auth` и затем в заголовке `x-admin-pin` на запросах
 * к пользователям. Письма — отдельный PIN: `POST /v1/email-manager/auth`
 * и заголовок `x-email-manager-pin`. Колонка `the_p` в ответах не
 * участвует: её можно только заменить.
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

const WALLET_ENTRY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 42, maxLength: 42 },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const

const PATCH_USER_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    balance: { type: 'string', minLength: 1, maxLength: 64 },
    the_p: { type: 'string', minLength: 1, maxLength: 256 },
    wallets: { type: 'array', items: WALLET_ENTRY_BODY },
    assets: { type: 'object' },
  },
} as const

const SEND_EMAIL_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['to', 'from', 'subject'],
  properties: {
    to: { type: 'string', minLength: 3, maxLength: 254 },
    from: { type: 'string', minLength: 3, maxLength: 254 },
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    html: { type: 'string', minLength: 1, maxLength: 32_000 },
    text: { type: 'string', minLength: 1, maxLength: 32_000 },
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

interface ISendEmailBody {
  readonly to: string
  readonly from: string
  readonly subject: string
  readonly html?: string
  readonly text?: string
}

interface IUserIdParams {
  readonly id: string
}

export function registerAdminRoutes(
  app: FastifyInstance,
  users: IUsersRepository,
  email: IEmailService,
): void {
  app.post<{ Body: IAuthBody }>(
    '/v1/admin/auth',
    { schema: { body: AUTH_BODY } },
    (request, reply) => {
      if (!pinMatches(request.body.pin.trim())) {
        throw new UnauthorizedError('Неверные учётные данные.')
      }

      void reply.header('cache-control', 'no-store')

      return { ok: true }
    },
  )

  app.get('/v1/admin/users', async (request, reply) => {
    requireAdminPin(request)

    const records = await users.list()

    void reply.header('cache-control', 'no-store')

    return { users: records.map(toUserResponse) }
  })

  app.get<{ Params: IUserIdParams }>('/v1/admin/users/:id', async (request, reply) => {
    requireAdminPin(request)

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
      requireAdminPin(request)

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
    requireAdminPin(request)

    const removed = await users.remove(request.params.id)

    if (!removed) {
      throw new NotFoundError('Пользователь не найден.')
    }

    void reply.status(204).header('cache-control', 'no-store')
  })

  app.post<{ Body: IAuthBody }>(
    '/v1/email-manager/auth',
    { schema: { body: AUTH_BODY } },
    (request, reply) => {
      if (!emailManagerPinMatches(request.body.pin.trim())) {
        throw new UnauthorizedError('Неверные учётные данные.')
      }

      void reply.header('cache-control', 'no-store')

      return { ok: true }
    },
  )

  app.get('/v1/admin/email', (request, reply) => {
    requireEmailManagerPin(request)

    void reply.header('cache-control', 'no-store')

    return { configured: email.isConfigured }
  })

  app.post<{ Body: ISendEmailBody }>(
    '/v1/admin/email/send',
    { schema: { body: SEND_EMAIL_BODY } },
    async (request, reply) => {
      requireEmailManagerPin(request)

      const message = readSendEmail(request.body)

      if (message === null) {
        throw new BadRequestError('invalid_request', 'Запрос не соответствует схеме.')
      }

      const result = await email.send(message)

      void reply.header('cache-control', 'no-store')

      return {
        delivered: result.delivered,
        queued: result.queued,
        permanentBounces: result.permanentBounces,
      }
    },
  )
}

function requireAdminPin(request: FastifyRequest): void {
  const header = request.headers['x-admin-pin']
  const pin = Array.isArray(header) ? header[0] : header

  if (typeof pin !== 'string' || !pinMatches(pin.trim())) {
    throw new UnauthorizedError('Неверные учётные данные.')
  }
}

function requireEmailManagerPin(request: FastifyRequest): void {
  const header = request.headers['x-email-manager-pin']
  const pin = Array.isArray(header) ? header[0] : header

  if (typeof pin !== 'string' || !emailManagerPinMatches(pin.trim())) {
    throw new UnauthorizedError('Неверные учётные данные.')
  }
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

function readSendEmail(body: ISendEmailBody): IEmailMessage | null {
  const to = body.to.trim()
  const from = body.from.trim()
  const subject = body.subject.trim()

  if (!isEmailAddress(to) || !isEmailAddress(from) || subject === '') {
    return null
  }

  const htmlRaw = body.html?.trim() ?? ''
  const textRaw = body.text?.trim() ?? ''
  const html =
    htmlRaw === '' || isBlankHtml(htmlRaw)
      ? textRaw === ''
        ? ''
        : wrapPlainTextAsHtml(textRaw)
      : htmlRaw
  const text = textRaw === '' ? htmlToPlainText(html) : textRaw

  if (text === '' || isBlankHtml(html)) {
    return null
  }

  return { to, from, subject, html, text }
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
