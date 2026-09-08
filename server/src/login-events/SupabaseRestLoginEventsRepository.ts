import { ServiceUnavailableError } from '../lib/errors.ts'
import { createSupabaseAdminClient } from '../users/supabase-clients.ts'

import type {
  ICreateLoginEventInput,
  ILoginEventRecord,
  ILoginEventsRepository,
} from './contracts.ts'

interface ILoginEventRow {
  readonly id: string
  readonly created_at: string
  readonly user_id: string | number
}

const LOGIN_EVENT_SELECT = 'id,created_at,user_id'
const PAGE_SIZE = 1000
const DEFAULT_LIST_LIMIT = 5000

/**
 * Login events via Supabase REST (`/rest/v1/login_events`).
 *
 * Owner is `user_id` (text `users.id`). Key is service-role: it
 * bypasses RLS. Calls run only after the Node check (PIN or email/the_p).
 */
export class LoginEventsDatabaseError extends ServiceUnavailableError {
  readonly operation: string
  readonly supabaseCode: string | null
  readonly isMissingTable: boolean

  constructor(
    operation: string,
    supabaseCode: string | null,
    flags: { readonly isMissingTable?: boolean } = {},
  ) {
    super('Database is unavailable.')
    this.name = 'LoginEventsDatabaseError'
    this.operation = operation
    this.supabaseCode = supabaseCode
    this.isMissingTable = flags.isMissingTable === true
  }
}

export class SupabaseRestLoginEventsRepository implements ILoginEventsRepository {
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

  async create(input: ICreateLoginEventInput): Promise<ILoginEventRecord> {
    const response = await this.#fetch(`${this.#url}/rest/v1/login_events`, {
      method: 'POST',
      headers: this.#writeHeaders(),
      body: JSON.stringify({ user_id: input.userId }),
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

  async list(options?: { readonly limit?: number }): Promise<readonly ILoginEventRecord[]> {
    return await this.#pagedQuery({ limit: options?.limit ?? DEFAULT_LIST_LIMIT })
  }

  async listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ILoginEventRecord[]> {
    return await this.#pagedQuery({
      userId,
      limit: options?.limit ?? 1000,
    })
  }

  async #pagedQuery(options: {
    readonly userId?: string
    readonly limit: number
  }): Promise<readonly ILoginEventRecord[]> {
    const collected: ILoginEventRecord[] = []
    let offset = 0

    while (collected.length < options.limit) {
      const take = Math.min(PAGE_SIZE, options.limit - collected.length)
      const page = await this.#query({
        ...(options.userId === undefined ? {} : { userId: options.userId }),
        limit: take,
        offset,
      })

      collected.push(...page)

      if (page.length < take) {
        break
      }

      offset += take
    }

    return collected
  }

  async #query(options: {
    readonly userId?: string
    readonly limit: number
    readonly offset: number
  }): Promise<readonly ILoginEventRecord[]> {
    const operation = options.userId === undefined ? 'list' : 'listByUserId'
    const endpoint = new URL(`${this.#url}/rest/v1/login_events`)
    endpoint.searchParams.set('select', LOGIN_EVENT_SELECT)
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', String(options.limit))
    endpoint.searchParams.set('offset', String(options.offset))

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

function parseRows(raw: string, operation: string): readonly ILoginEventRow[] {
  if (raw.trim() === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new LoginEventsDatabaseError(operation, null)
  }

  if (!Array.isArray(parsed)) {
    throw new LoginEventsDatabaseError(operation, null)
  }

  return parsed as ILoginEventRow[]
}

function toRecord(row: ILoginEventRow): ILoginEventRecord {
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    userId: String(row.user_id),
  }
}

function unavailable(operation: string, status: number, raw: string): LoginEventsDatabaseError {
  return new LoginEventsDatabaseError(operation, readSupabaseCode(status, raw), {
    isMissingTable: isMissingLoginEventsTableError(raw),
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

export function isMissingLoginEventsTableError(message: string): boolean {
  return (
    message.includes('PGRST205') ||
    message.includes("Could not find the table 'public.login_events'")
  )
}
