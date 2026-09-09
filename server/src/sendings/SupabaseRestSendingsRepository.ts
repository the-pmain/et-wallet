import { ServiceUnavailableError } from '../lib/errors.ts'
import { createSupabaseAdminClient } from '../users/supabase-clients.ts'

import type {
  ICreateSendingInput,
  ISendingRecord,
  ISendingsRepository,
  IUpdateSendingInput,
} from './contracts.ts'
import { normalizeSendingStatus, SENDING_STATUS } from './status.ts'

interface ISendingRow {
  readonly id: string | number
  readonly created_at: string
  readonly user_id: string | number | null
  readonly status: string | null
  readonly failure_message: string | null
  readonly recipient_address: string | null
  readonly amount: string | null
  readonly asset_symbol: string | null
}

interface IInsertFailure {
  readonly ok: false
  readonly status: number
  readonly raw: string
}

const SENDING_SELECT =
  'id,created_at,user_id,status,failure_message,recipient_address,amount,asset_symbol'

/**
 * Transfers via Supabase REST (`/rest/v1/sendings`).
 *
 * Columns: id, created_at, status, failure_message, recipient_address,
 * amount, user_id, asset_symbol. Owner is `user_id` (text `users.id`),
 * not `auth.uid()`. Key is service-role: it bypasses RLS. Calls run
 * only after the Node check (`email`/`the_p` or PIN).
 */
export class SendingsDatabaseError extends ServiceUnavailableError {
  readonly operation: string
  readonly supabaseCode: string | null
  readonly isBrokenIdFk: boolean
  readonly isMissingTable: boolean

  constructor(
    operation: string,
    supabaseCode: string | null,
    flags: { readonly isBrokenIdFk?: boolean; readonly isMissingTable?: boolean } = {},
  ) {
    super('Database is unavailable.')
    this.name = 'SendingsDatabaseError'
    this.operation = operation
    this.supabaseCode = supabaseCode
    this.isBrokenIdFk = flags.isBrokenIdFk === true
    this.isMissingTable = flags.isMissingTable === true
  }
}

export class SupabaseRestSendingsRepository implements ISendingsRepository {
  readonly #url: string
  readonly #adminHeaders: Readonly<Record<string, string>>
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly supabaseUrl: string
    readonly serviceRoleKey: string
    readonly fetch?: typeof fetch
  }) {
    this.#url = options.supabaseUrl.replace(/\/$/u, '')
    this.#adminHeaders = createSupabaseAdminClient({
      supabaseUrl: options.supabaseUrl,
      serviceRoleKey: options.serviceRoleKey,
    }).headers
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async create(input: ICreateSendingInput): Promise<ISendingRecord> {
    const payload = {
      user_id: input.userId,
      status: input.status ?? SENDING_STATUS.Pending,
      failure_message: input.failureMessage ?? null,
      recipient_address: input.recipientAddress,
      amount: input.amount,
      asset_symbol: input.symbol,
    }

    const first = await this.#insert(payload)

    if (first.ok) {
      return first.record
    }

    if (!isBrokenInsert(first)) {
      throw unavailable('create', first.status, first.raw)
    }

    /*
     * Dashboard schema keeps `sendings_id_fkey` on `id` → `users(id)` and
     * stores `user_id` as text. Identity then emits 1, 2, 3… and Postgres
     * rejects any id that is not already a user. Reuse a free `users.id`
     * as the sending primary key; `user_id` still names the owner.
     */
    const preferredId = readPositiveInt(input.userId)

    if (preferredId !== null) {
      const preferred = await this.#insert({ ...payload, id: preferredId })

      if (preferred.ok) {
        return preferred.record
      }

      if (!isBrokenInsert(preferred)) {
        throw unavailable('create', preferred.status, preferred.raw)
      }
    }

    const allocatedId = await this.#unusedUserIdAsSendingId(preferredId)
    const allocated = await this.#insert({
      ...payload,
      id: allocatedId,
    })

    if (allocated.ok) {
      return allocated.record
    }

    throw unavailable('create', allocated.status, allocated.raw)
  }

  async update(id: string, patch: IUpdateSendingInput): Promise<ISendingRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set('id', `eq.${id}`)

    const response = await this.#fetch(endpoint.toString(), {
      method: 'PATCH',
      headers: this.#writeHeaders(),
      body: JSON.stringify({
        status: patch.status,
        failure_message: patch.failureMessage ?? null,
        ...(patch.recipientAddress === undefined
          ? {}
          : { recipient_address: patch.recipientAddress }),
        ...(patch.amount === undefined ? {} : { amount: patch.amount }),
        ...(patch.symbol === undefined ? {} : { asset_symbol: patch.symbol }),
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('update', response.status, raw)
    }

    const row = parseRows(raw, 'update')[0]

    return row === undefined ? null : toRecord(row)
  }

  async findById(id: string): Promise<ISendingRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set('select', SENDING_SELECT)
    endpoint.searchParams.set('id', `eq.${id}`)
    endpoint.searchParams.set('limit', '1')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('findById', response.status, raw)
    }

    const row = parseRows(raw, 'findById')[0]

    return row === undefined ? null : toRecord(row)
  }

  async listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ISendingRecord[]> {
    const limit = options?.limit ?? 100
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set('select', SENDING_SELECT)
    endpoint.searchParams.set('user_id', `eq.${userId}`)
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(limit))

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('listByUserId', response.status, raw)
    }

    return parseRows(raw, 'listByUserId').map(toRecord)
  }

  async list(options?: { readonly limit?: number }): Promise<readonly ISendingRecord[]> {
    const limit = options?.limit ?? 200
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set('select', SENDING_SELECT)
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(limit))

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('list', response.status, raw)
    }

    return parseRows(raw, 'list').map(toRecord)
  }

  async #insert(
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; record: ISendingRecord } | IInsertFailure> {
    const response = await this.#fetch(`${this.#url}/rest/v1/sendings`, {
      method: 'POST',
      headers: this.#writeHeaders(),
      body: JSON.stringify(payload),
    })

    const raw = await response.text()

    if (!response.ok) {
      return { ok: false, status: response.status, raw }
    }

    const row = parseRows(raw, 'create')[0]

    if (row === undefined) {
      return { ok: false, status: response.status, raw }
    }

    return { ok: true, record: toRecord(row) }
  }

  async #unusedUserIdAsSendingId(exclude: number | null): Promise<number> {
    const used = new Set(await this.#listIds('sendings'))

    if (exclude !== null) {
      used.add(exclude)
    }

    const free = (await this.#listIds('users')).find((id) => !used.has(id))

    if (free === undefined) {
      throw new SendingsDatabaseError('create', 'sendings_id_fkey', { isBrokenIdFk: true })
    }

    return free
  }

  async #listIds(table: 'sendings' | 'users'): Promise<readonly number[]> {
    const endpoint = new URL(`${this.#url}/rest/v1/${table}`)
    endpoint.searchParams.set('select', 'id')
    endpoint.searchParams.set('order', 'id.asc')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('listIds', response.status, raw)
    }

    return parseIds(raw)
  }

  #readHeaders(): Record<string, string> {
    return { ...this.#adminHeaders }
  }

  #writeHeaders(): Record<string, string> {
    return {
      ...this.#readHeaders(),
      'content-type': 'application/json',
      prefer: 'return=representation',
    }
  }
}

function parseRows(raw: string, operation: string): readonly ISendingRow[] {
  if (raw.trim() === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new SendingsDatabaseError(operation, null)
  }

  if (!Array.isArray(parsed)) {
    throw new SendingsDatabaseError(operation, null)
  }

  return parsed as ISendingRow[]
}

function toRecord(row: ISendingRow): ISendingRecord {
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    status: normalizeSendingStatus(row.status),
    failureMessage: row.failure_message ?? null,
    recipientAddress: row.recipient_address ?? null,
    amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
    symbol: typeof row.asset_symbol === 'string' ? row.asset_symbol : null,
  }
}

function unavailable(operation: string, status: number, raw: string): SendingsDatabaseError {
  return new SendingsDatabaseError(operation, readSupabaseCode(status, raw), {
    isBrokenIdFk: isBrokenSendingsIdFkError(raw),
    isMissingTable: isMissingSendingsTableError(raw),
  })
}

function isBrokenInsert(failure: IInsertFailure): boolean {
  return isBrokenSendingsIdFkError(failure.raw)
}

function readSupabaseCode(status: number, raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw)

    if (parsed !== null && typeof parsed === 'object') {
      const code = (parsed as { readonly code?: unknown }).code

      if (typeof code === 'string' && code.trim() !== '') {
        return code
      }
    }
  } catch {
    /* Body is not JSON — it does not reach the client response. */
  }

  return String(status)
}

export function isMissingSendingsTableError(message: string): boolean {
  return (
    message.includes('PGRST205') ||
    message.includes("Could not find the table 'public.sendings'")
  )
}

/** `sendings_id_fkey` requires sendings.id to already exist in users.id. */
export function isBrokenSendingsIdFkError(message: string): boolean {
  return (
    message.includes('sendings_id_fkey') ||
    message.includes('must match an unused users.id') ||
    message.includes('unused users.id, and none are left') ||
    (message.includes('23503') && message.includes('table \\"users\\"')) ||
    (message.includes('23503') && message.includes('table "users"')) ||
    (message.includes('23505') &&
      (message.includes('sendings_pkey') || message.includes('Key (id)=')))
  )
}

export function isBrokenSendingsFk(error: unknown): boolean {
  if (error instanceof SendingsDatabaseError) {
    return error.isBrokenIdFk
  }

  return error instanceof ServiceUnavailableError && isBrokenSendingsIdFkError(error.message)
}

function readPositiveInt(value: string): number | null {
  if (!/^\d+$/u.test(value)) {
    return null
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseIds(raw: string): readonly number[] {
  return parseRows(raw, 'listIds')
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0)
}
