import { EmailSendError, EmailUnavailableError } from '../lib/errors.ts'

import type { IEmailMessage, IEmailSendResult, IEmailService } from './contracts.ts'
import { isCloudflareGlobalApiKey } from './credentials.ts'
import { isEmailAddress } from './address.ts'

const SEND_PATH = '/email/sending/send'

const MISSING_TOKEN_MESSAGE =
  'Email sending is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'

const MISSING_EMAIL_MESSAGE =
  'CLOUDFLARE_API_TOKEN is a Global API Key (cfk_). Set CLOUDFLARE_EMAIL to the Cloudflare login email, or replace it with an API token (cfut_ / cfat_) that has Email Sending: Edit.'

/**
 * Отправка через REST Cloudflare Email Sending.
 *
 * ТОкен НЕ ПОПАДАЕТ В ЖУРНАЛ И В ОТВЕТ. Сообщение об отказе берётся
 * из поля `errors[].message`, которое Cloudflare публикует как
 * машинный код, а не как секрет.
 *
 * Глобальный ключ (`cfk_`) и API-токен (`cfut_` / `cfat_`) — разные
 * секреты. Bearer принимает только токен. Ключ идёт парой
 * `X-Auth-Email` + `X-Auth-Key`.
 */

export class CloudflareEmailService implements IEmailService {
  readonly #accountId: string | null
  readonly #apiToken: string | null
  readonly #authEmail: string | null
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly accountId: string | null
    readonly apiToken: string | null
    readonly authEmail?: string | null
    readonly fetch?: typeof fetch
  }) {
    this.#accountId = options.accountId
    this.#apiToken = options.apiToken
    this.#authEmail = options.authEmail ?? null
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  get isConfigured(): boolean {
    return this.#missingConfigMessage() === null
  }

  async send(message: IEmailMessage): Promise<IEmailSendResult> {
    const missing = this.#missingConfigMessage()

    if (missing !== null) {
      throw new EmailUnavailableError(missing)
    }

    const accountId = this.#accountId
    const apiToken = this.#apiToken

    if (accountId === null || apiToken === null) {
      throw new EmailUnavailableError(MISSING_TOKEN_MESSAGE)
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}${SEND_PATH}`

    let response: Response

    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          ...authorizationHeaders(apiToken, this.#authEmail),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: message.to,
          from: message.from,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new EmailUnavailableError('Could not reach Cloudflare Email Sending.')
    }

    const raw = await response.text()
    const envelope = parseEnvelope(raw)

    if (envelope === null) {
      throw new EmailSendError(502, 'Cloudflare returned a response that was not JSON.')
    }

    if (!envelope.success) {
      throw mapCloudflareFailure(response.status, envelope.errorMessage)
    }

    return {
      delivered: envelope.delivered,
      queued: envelope.queued,
      permanentBounces: envelope.permanentBounces,
    }
  }

  #missingConfigMessage(): string | null {
    if (this.#accountId === null || this.#apiToken === null) {
      return MISSING_TOKEN_MESSAGE
    }

    if (
      isCloudflareGlobalApiKey(this.#apiToken) &&
      (this.#authEmail === null || !isEmailAddress(this.#authEmail))
    ) {
      return MISSING_EMAIL_MESSAGE
    }

    return null
  }
}

function authorizationHeaders(
  secret: string,
  authEmail: string | null,
): Record<string, string> {
  if (isCloudflareGlobalApiKey(secret)) {
    if (authEmail === null || !isEmailAddress(authEmail)) {
      throw new EmailUnavailableError(MISSING_EMAIL_MESSAGE)
    }

    return {
      'X-Auth-Email': authEmail,
      'X-Auth-Key': secret,
    }
  }

  return {
    Authorization: `Bearer ${secret}`,
  }
}

interface ICloudflareEnvelope {
  readonly success: boolean
  readonly errorMessage: string | null
  readonly delivered: readonly string[]
  readonly queued: readonly string[]
  readonly permanentBounces: readonly string[]
}

function parseEnvelope(raw: string): ICloudflareEnvelope | null {
  if (raw.trim() === '') {
    return {
      success: false,
      errorMessage: 'Cloudflare returned an empty response.',
      delivered: [],
      queued: [],
      permanentBounces: [],
    }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const success = record['success'] === true
  const result = record['result']
  const resultRecord =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null

  return {
    success,
    errorMessage: firstErrorMessage(record['errors']),
    delivered: readStringList(resultRecord?.['delivered']),
    queued: readStringList(resultRecord?.['queued']),
    permanentBounces: readStringList(resultRecord?.['permanent_bounces']),
  }
}

function firstErrorMessage(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) {
    return null
  }

  const first: unknown = errors[0]

  if (first === null || typeof first !== 'object') {
    return null
  }

  const message = (first as Record<string, unknown>)['message']

  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null
}

function readStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function mapCloudflareFailure(
  status: number,
  errorMessage: string | null,
): EmailSendError | EmailUnavailableError {
  const detail = errorMessage ?? 'Cloudflare rejected the email.'

  if (status === 401 || status === 403) {
    if (detail === 'Authentication error') {
      return new EmailUnavailableError(
        'Cloudflare rejected the credentials. A Global API Key needs CLOUDFLARE_EMAIL; an API token must start with cfut_ or cfat_ and have Email Sending: Edit.',
      )
    }

    return new EmailUnavailableError(`Cloudflare rejected the sending token: ${detail}`)
  }

  if (status === 429) {
    return new EmailSendError(429, 'Cloudflare rate-limited email sending. Try again later.')
  }

  if (status >= 500) {
    return new EmailUnavailableError(`Cloudflare Email Sending is unavailable: ${detail}`)
  }

  const mapped = status >= 400 && status < 500 ? status : 400

  return new EmailSendError(mapped, detail)
}
