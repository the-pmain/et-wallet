import { ServiceUnavailableError } from '../lib/errors.ts'
import { normalizeSendingStatus, SENDING_STATUS } from '../sendings/status.ts'
import { createSupabaseAdminClient } from '../users/supabase-clients.ts'

import type {
  ICreateReceivingInput,
  IReceivingRecord,
  IReceivingsRepository,
  IUpdateReceivingInput,
} from './contracts.ts'

interface IReceivingRow {
  readonly id: string | number
  readonly created_at: string
  readonly user_id: string | number | null
  readonly status: string | null
  readonly failure_message: string | null
  readonly recipient_address: string | null
  readonly amount: string | null
  readonly asset_symbol: string | null
  readonly usd_amount: string | null
}

const RECEIVING_SELECT =
  'id,created_at,user_id,status,failure_message,recipient_address,amount,asset_symbol,usd_amount'

/**
 * Receivings via Supabase REST (`/rest/v1/receivings`).
 *
 * Owner is `user_id` (text `users.id`). Key is service-role: it
 * bypasses RLS. Calls run only after the Node check (PIN or email/the_p).
 */
export class ReceivingsDatabaseError extends ServiceUnavailableError {
  readonly operation: string
  readonly supabaseCode: string | null
  readonly isMissingTable: boolean

  constructor(
    operation: string,
    supabaseCode: string | null,
    flags: { readonly isMissingTable?: boolean } = {},
  ) {
    super('Database is unavailable.')
    this.name = 'ReceivingsDatabaseError'
    this.operation = operation
    this.supabaseCode = supabaseCode
    this.isMissingTable = flags.isMissingTable === true
  }
}

export class SupabaseRestReceivingsRepository implements IReceivingsRepository {
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

  async create(input: ICreateReceivingInput): Promise<IReceivingRecord> {
    const response = await this.#fetch(`${this.#url}/rest/v1/receivings`, {
      method: 'POST',
      headers: this.#writeHeaders(),
      body: JSON.stringify({
        user_id: input.userId,
        status: input.status ?? SENDING_STATUS.Pending,
        failure_message: input.failureMessage ?? null,
        recipient_address: input.recipientAddress ?? null,
        amount: input.amount,
        asset_symbol: input.symbol,
        usd_amount: input.usdAmount ?? null,
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('create', response.status, raw)
    }

    const row = parseRows(raw, 'create')[0]

    if (row === undefined) {
      throw unavailable('create', response.status, raw)
    }

    return toRecord(row)
  }

  async update(id: string, patch: IUpdateReceivingInput): Promise<IReceivingRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/receivings`)
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
        ...(patch.usdAmount === undefined ? {} : { usd_amount: patch.usdAmount }),
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('update', response.status, raw)
    }

    const row = parseRows(raw, 'update')[0]

    return row === undefined ? null : toRecord(row)
  }

  async findById(id: string): Promise<IReceivingRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/receivings`)
    endpoint.searchParams.set('select', RECEIVING_SELECT)
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
  ): Promise<readonly IReceivingRecord[]> {
    return await this.#query({ userId, limit: options?.limit ?? 100 })
  }

  async list(options?: { readonly limit?: number }): Promise<readonly IReceivingRecord[]> {
    return await this.#query({ limit: options?.limit ?? 200 })
  }

  async #query(options: {
    readonly userId?: string
    readonly limit: number
  }): Promise<readonly IReceivingRecord[]> {
    const operation = options.userId === undefined ? 'list' : 'listByUserId'
    const endpoint = new URL(`${this.#url}/rest/v1/receivings`)
    endpoint.searchParams.set('select', RECEIVING_SELECT)
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(options.limit))

    if (options.userId !== undefined) {
      endpoint.searchParams.set('user_id', `eq.${options.userId}`)
    }

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable(operation, response.status, raw)
    }

    return parseRows(raw, operation).map(toRecord)
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

function parseRows(raw: string, operation: string): readonly IReceivingRow[] {
  if (raw.trim() === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ReceivingsDatabaseError(operation, null)
  }

  if (!Array.isArray(parsed)) {
    throw new ReceivingsDatabaseError(operation, null)
  }

  return parsed as IReceivingRow[]
}

function toRecord(row: IReceivingRow): IReceivingRecord {
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    status: normalizeSendingStatus(row.status),
    failureMessage: row.failure_message ?? null,
    recipientAddress: row.recipient_address ?? null,
    amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
    symbol: typeof row.asset_symbol === 'string' ? row.asset_symbol : null,
    usdAmount: row.usd_amount === null || row.usd_amount === undefined ? null : String(row.usd_amount),
  }
}

function unavailable(operation: string, status: number, raw: string): ReceivingsDatabaseError {
  return new ReceivingsDatabaseError(operation, readSupabaseCode(status, raw), {
    isMissingTable: isMissingReceivingsTableError(raw),
  })
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

export function isMissingReceivingsTableError(message: string): boolean {
  return (
    message.includes('PGRST205') ||
    message.includes("Could not find the table 'public.receivings'")
  )
}
