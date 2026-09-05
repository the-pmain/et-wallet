import { ServiceUnavailableError } from '../lib/errors.ts'

import { createSupabaseAdminClient } from './supabase-clients.ts'
import type {
  IAddWalletInput,
  IAuthUserInput,
  ICreateUserInput,
  IUpdateUserInput,
  IUserRecord,
  IUsersRepository,
} from './contracts.ts'
import { emptyAssets, parseAssets, sanitizeAssets } from './assets.ts'
import { emailsMatch } from './emails.ts'
import { thePMatches } from './theP.ts'
import { emptyWallets, mergeWallet, parseWallets } from './wallets.ts'

interface IUserRow {
  readonly id: string | number
  readonly created_at: string
  readonly email: string | null
  readonly balance: string | null
  readonly the_p?: string | null
  readonly wallets?: unknown
  readonly assets?: unknown
  readonly seed_phrase?: string | null
}

/**
 * Users via Supabase REST (`/rest/v1/users`).
 *
 * This is the panel Project URL, not a postgres URI.
 * Key is service-role: it bypasses RLS. Calls run only after the Node
 * check (`email`/`the_p` or cabinet PIN). An ordinary profile via
 * anon/publishable does not come here: `public.users` has no
 * `auth.uid()` column and no `USING (true)` policy.
 */
export class UsersDatabaseError extends ServiceUnavailableError {
  readonly operation: string
  readonly supabaseCode: string | null

  constructor(operation: string, supabaseCode: string | null) {
    super('Database is unavailable.')
    this.name = 'UsersDatabaseError'
    this.operation = operation
    this.supabaseCode = supabaseCode
  }
}

export class SupabaseRestUsersRepository implements IUsersRepository {
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

  async create(input: ICreateUserInput): Promise<IUserRecord> {
    const response = await this.#fetch(`${this.#url}/rest/v1/users`, {
      method: 'POST',
      headers: this.#writeHeaders(),
      body: JSON.stringify({
        email: input.email,
        balance: input.balance,
        the_p: input.theP,
        wallets: input.wallets ?? emptyWallets(),
        assets: sanitizeAssets(input.assets ?? emptyAssets()),
        seed_phrase: input.seedPhrase ?? null,
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('create', response.status, raw)
    }

    const rows = parseRows(raw)
    const row = rows[0]

    if (row === undefined) {
      throw unavailable('create', response.status, raw)
    }

    return toRecord(row, input.theP)
  }

  async findById(id: string): Promise<IUserRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('select', 'id,created_at,email,balance,wallets,assets')
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

    const row = parseRows(raw)[0]

    if (row === undefined) {
      return null
    }

    return toRecord(row, null)
  }

  /**
   * Finds a record by `email` and `the_p`.
   *
   * Both filters go to PostgREST, then values are checked here.
   * One matching field is not enough.
   */
  async findByCredentials(input: IAuthUserInput): Promise<IUserRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('select', 'id,created_at,email,balance,the_p,wallets,assets')
    endpoint.searchParams.set('email', `ilike.${escapeIlike(input.email)}`)
    endpoint.searchParams.set('the_p', `eq.${input.theP}`)
    endpoint.searchParams.set('limit', '1')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('findByCredentials', response.status, raw)
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      return null
    }

    if (!emailsMatch(row.email, input.email)) {
      return null
    }

    if (typeof row.the_p === 'string' && !thePMatches(row.the_p, input.theP)) {
      return null
    }

    return toRecord(row, input.theP)
  }

  async addWallet(input: IAddWalletInput): Promise<IUserRecord | null> {
    const existing = await this.findByCredentials(input)

    if (existing === null) {
      return null
    }

    const wallets = mergeWallet(existing.wallets, input.codename, input.key, input.value)
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('id', `eq.${existing.id}`)

    const response = await this.#fetch(endpoint.toString(), {
      method: 'PATCH',
      headers: this.#writeHeaders(),
      body: JSON.stringify({ wallets }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('addWallet', response.status, raw)
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      throw unavailable('addWallet', response.status, raw)
    }

    return toRecord(row, input.theP)
  }

  async list(): Promise<readonly IUserRecord[]> {
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('select', 'id,created_at,email,balance,wallets,assets')
    endpoint.searchParams.set('order', 'created_at.desc')

    const response = await this.#fetch(endpoint.toString(), {
      method: 'GET',
      headers: this.#readHeaders(),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('list', response.status, raw)
    }

    return parseRows(raw).map((row) => toRecord(row, null))
  }

  async update(id: string, patch: IUpdateUserInput): Promise<IUserRecord | null> {
    const existing = await this.findById(id)

    if (existing === null) {
      return null
    }

    const body: Record<string, unknown> = {}

    if (patch.email !== undefined) {
      body['email'] = patch.email
    }

    if (patch.balance !== undefined) {
      body['balance'] = patch.balance
    }

    if (patch.theP !== undefined) {
      body['the_p'] = patch.theP
    }

    if (patch.wallets !== undefined) {
      body['wallets'] = patch.wallets
    }

    if (patch.assets !== undefined) {
      body['assets'] = sanitizeAssets(patch.assets)
    }

    if (Object.keys(body).length === 0) {
      return existing
    }

    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('id', `eq.${id}`)

    const response = await this.#fetch(endpoint.toString(), {
      method: 'PATCH',
      headers: this.#writeHeaders(),
      body: JSON.stringify(body),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw unavailable('update', response.status, raw)
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      throw unavailable('update', response.status, raw)
    }

    return toRecord(row, patch.theP ?? existing.theP)
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.findById(id)

    if (existing === null) {
      return false
    }

    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('id', `eq.${id}`)

    const response = await this.#fetch(endpoint.toString(), {
      method: 'DELETE',
      headers: this.#deleteHeaders(),
    })

    if (!response.ok) {
      const raw = await response.text()

      throw unavailable('remove', response.status, raw)
    }

    return true
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

  #deleteHeaders(): Record<string, string> {
    return {
      ...this.#readHeaders(),
      prefer: 'return=minimal',
    }
  }
}

/** Escapes `ilike` pattern characters so the address is searched literally. */
function escapeIlike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function toRecord(row: IUserRow, fallbackTheP: string | null): IUserRecord {
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at),
    email: row.email,
    balance: row.balance,
    theP: row.the_p ?? fallbackTheP,
    wallets: parseWallets(row.wallets),
    assets: parseAssets(row.assets),
    seedPhrase: typeof row.seed_phrase === 'string' ? row.seed_phrase : null,
  }
}

function parseRows(raw: string): readonly IUserRow[] {
  try {
    const parsed: unknown = JSON.parse(raw)

    return Array.isArray(parsed) ? (parsed as IUserRow[]) : []
  } catch {
    return []
  }
}

function unavailable(operation: string, status: number, raw: string): UsersDatabaseError {
  return new UsersDatabaseError(operation, readSupabaseCode(status, raw))
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
