import { ServiceUnavailableError } from '../lib/errors.ts'

import {
  EMAIL_DIRECTION,
  type ICreateEmailInput,
  type IEmailRecord,
  type IEmailsRepository,
} from './contracts.ts'
import { isEmailDirection } from './MemoryEmailsRepository.ts'

/** Строка PostgREST `public.emails`. */
interface IEmailRow {
  readonly id: string | number
  readonly created_at: string
  readonly direction: string
  readonly from_addr: string
  readonly to_addr: string
  readonly subject: string
  readonly html: string | null
  readonly text: string | null
  readonly status: string
  readonly provider_result?: unknown
  readonly external_id?: string | null
}

/**
 * Журнал писем через Supabase REST (`/rest/v1/emails`).
 */
export class SupabaseRestEmailsRepository implements IEmailsRepository {
  readonly #url: string
  readonly #anonKey: string
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly supabaseUrl: string
    readonly anonKey: string
    readonly fetch?: typeof fetch
  }) {
    this.#url = options.supabaseUrl.replace(/\/$/u, '')
    this.#anonKey = options.anonKey
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async create(input: ICreateEmailInput): Promise<IEmailRecord> {
    const response = await this.#fetch(`${this.#url}/rest/v1/emails`, {
      method: 'POST',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        direction: input.direction,
        from_addr: input.from,
        to_addr: input.to,
        subject: input.subject,
        html: input.html ?? null,
        text: input.text ?? null,
        status: input.status,
        provider_result: input.providerResult ?? null,
        external_id: input.externalId ?? null,
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const rows = parseRows(raw)
    const row = rows[0]

    if (row === undefined) {
      throw new ServiceUnavailableError('Supabase не вернул созданную запись письма.')
    }

    return toRecord(row)
  }

  async list(options?: { readonly limit?: number }): Promise<readonly IEmailRecord[]> {
    const limit = options?.limit ?? 100
    const endpoint = new URL(`${this.#url}/rest/v1/emails`)
    endpoint.searchParams.set(
      'select',
      'id,created_at,direction,from_addr,to_addr,subject,html,text,status,provider_result,external_id',
    )
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(limit))

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
      },
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    return parseRows(raw).map(toRecord)
  }

  async findById(id: string): Promise<IEmailRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/emails`)
    endpoint.searchParams.set(
      'select',
      'id,created_at,direction,from_addr,to_addr,subject,html,text,status,provider_result,external_id',
    )
    endpoint.searchParams.set('id', `eq.${id}`)
    endpoint.searchParams.set('limit', '1')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
      },
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    return row === undefined ? null : toRecord(row)
  }

  async findByExternalId(externalId: string): Promise<IEmailRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/emails`)
    endpoint.searchParams.set(
      'select',
      'id,created_at,direction,from_addr,to_addr,subject,html,text,status,provider_result,external_id',
    )
    endpoint.searchParams.set('external_id', `eq.${externalId}`)
    endpoint.searchParams.set('limit', '1')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
      },
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    return row === undefined ? null : toRecord(row)
  }
}

function parseRows(raw: string): readonly IEmailRow[] {
  if (raw.trim() === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ServiceUnavailableError('Supabase вернул ответ, который не является JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new ServiceUnavailableError('Supabase вернул неожиданную форму ответа.')
  }

  return parsed as IEmailRow[]
}

function toRecord(row: IEmailRow): IEmailRecord {
  const direction = isEmailDirection(row.direction) ? row.direction : EMAIL_DIRECTION.Received

  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    direction,
    from: row.from_addr,
    to: row.to_addr,
    subject: row.subject,
    html: row.html,
    text: row.text,
    status: row.status,
    providerResult: row.provider_result ?? null,
    externalId: row.external_id ?? null,
  }
}

function summarizeSupabaseError(status: number, raw: string): string {
  const clipped = raw.trim().slice(0, 240)

  return clipped === ''
    ? `Supabase ответил ${String(status)}.`
    : `Supabase ответил ${String(status)}: ${clipped}`
}

/** PostgREST 404 when `public.emails` was never created. */
export function isMissingEmailsTableError(message: string): boolean {
  return (
    message.includes('PGRST205') ||
    message.includes("Could not find the table 'public.emails'")
  )
}
