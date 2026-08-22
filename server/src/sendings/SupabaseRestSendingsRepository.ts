import { ServiceUnavailableError } from '../lib/errors.ts'

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

const SENDING_SELECT =
  'id,created_at,user_id,status,failure_message,recipient_address,amount,asset_symbol'

export class SupabaseRestSendingsRepository implements ISendingsRepository {
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

    if (!isBrokenSendingsIdFkError(first.message)) {
      throw new ServiceUnavailableError(first.message)
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

      if (!isBrokenSendingsIdFkError(preferred.message)) {
        throw new ServiceUnavailableError(preferred.message)
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

    throw new ServiceUnavailableError(allocated.message)
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
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    return row === undefined ? null : toRecord(row)
  }

  async findById(id: string): Promise<ISendingRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set(
      'select',
      SENDING_SELECT,
    )
    endpoint.searchParams.set('id', `eq.${id}`)
    endpoint.searchParams.set('limit', '1')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    return row === undefined ? null : toRecord(row)
  }

  async listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ISendingRecord[]> {
    const limit = options?.limit ?? 100
    const endpoint = new URL(`${this.#url}/rest/v1/sendings`)
    endpoint.searchParams.set(
      'select',
      SENDING_SELECT,
    )
    endpoint.searchParams.set('user_id', `eq.${userId}`)
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(limit))

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    return parseRows(raw).map(toRecord)
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
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    return parseRows(raw).map(toRecord)
  }

  async #insert(
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; record: ISendingRecord } | { ok: false; message: string }> {
    const response = await this.#fetch(`${this.#url}/rest/v1/sendings`, {
      method: 'POST',
      headers: this.#writeHeaders(),
      body: JSON.stringify(payload),
    })

    const raw = await response.text()

    if (!response.ok) {
      return { ok: false, message: summarizeSupabaseError(response.status, raw) }
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      return { ok: false, message: 'Supabase did not return the created sending record.' }
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
      throw new ServiceUnavailableError(
        'sendings.id must match an unused users.id while sendings_id_fkey exists, and none are left.',
      )
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
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    return parseIds(raw)
  }

  #writeHeaders(): Record<string, string> {
    return {
      apikey: this.#anonKey,
      authorization: `Bearer ${this.#anonKey}`,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: 'return=representation',
    }
  }

  #readHeaders(): Record<string, string> {
    return {
      apikey: this.#anonKey,
      authorization: `Bearer ${this.#anonKey}`,
      accept: 'application/json',
    }
  }
}

function parseRows(raw: string): readonly ISendingRow[] {
  if (raw.trim() === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ServiceUnavailableError('Supabase returned a non-JSON response.')
  }

  if (!Array.isArray(parsed)) {
    throw new ServiceUnavailableError('Supabase returned an unexpected response shape.')
  }

  return parsed as ISendingRow[]
}

function toRecord(row: ISendingRow): ISendingRecord {
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    userId: row.user_id === null ? null : String(row.user_id),
    status: normalizeSendingStatus(row.status),
    failureMessage: row.failure_message,
    recipientAddress: row.recipient_address,
    amount: row.amount,
    symbol: typeof row.asset_symbol === 'string' ? row.asset_symbol : null,
  }
}

function summarizeSupabaseError(status: number, raw: string): string {
  const clipped = raw.trim().slice(0, 240)

  return clipped === ''
    ? `Supabase responded with ${String(status)}.`
    : `Supabase responded with ${String(status)}: ${clipped}`
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
    (message.includes('23503') && message.includes('table \\"users\\"')) ||
    (message.includes('23505') &&
      (message.includes('sendings_pkey') || message.includes('Key (id)=')))
  )
}

function readPositiveInt(value: string): number | null {
  if (!/^\d+$/u.test(value)) {
    return null
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseIds(raw: string): readonly number[] {
  return parseRows(raw)
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0)
}
