import { ServiceUnavailableError } from '../lib/errors.ts'

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

/** Строка, которую возвращает PostgREST. */
interface IUserRow {
  readonly id: string | number
  readonly created_at: string
  readonly email: string | null
  readonly balance: string | null
  readonly the_p?: string | null
  readonly wallets?: unknown
  readonly assets?: unknown
}

/**
 * Пользователи через Supabase REST (`/rest/v1/users`).
 *
 * Это тот URL, который лежит в панели как Project URL, а не postgres URI.
 * Анонимный ключ живёт только на сервере.
 */
export class SupabaseRestUsersRepository implements IUsersRepository {
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

  async create(input: ICreateUserInput): Promise<IUserRecord> {
    const response = await this.#fetch(`${this.#url}/rest/v1/users`, {
      method: 'POST',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        email: input.email,
        balance: input.balance,
        the_p: input.theP,
        wallets: input.wallets ?? emptyWallets(),
        assets: sanitizeAssets(input.assets ?? emptyAssets()),
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const rows = parseRows(raw)
    const row = rows[0]

    if (row === undefined) {
      throw new ServiceUnavailableError('Supabase не вернул созданную запись.')
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

    if (row === undefined) {
      return null
    }

    return toRecord(row, null)
  }

  /**
   * Ищет запись по `email` и `the_p`.
   *
   * Оба фильтра уходят в PostgREST, затем значения сверяются здесь.
   * Одно совпавшее поле недостаточно.
   */
  async findByCredentials(input: IAuthUserInput): Promise<IUserRecord | null> {
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('select', 'id,created_at,email,balance,the_p,wallets,assets')
    endpoint.searchParams.set('email', `ilike.${escapeIlike(input.email)}`)
    endpoint.searchParams.set('the_p', `eq.${input.theP}`)
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

    const wallets = mergeWallet(existing.wallets, input.key, input.value)
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('id', `eq.${existing.id}`)

    const response = await this.#fetch(endpoint.toString(), {
      method: 'PATCH',
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ wallets }),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      throw new ServiceUnavailableError('Supabase не вернул обновлённую запись.')
    }

    return toRecord(row, input.theP)
  }

  async list(): Promise<readonly IUserRecord[]> {
    const endpoint = new URL(`${this.#url}/rest/v1/users`)
    endpoint.searchParams.set('select', 'id,created_at,email,balance,wallets,assets')
    endpoint.searchParams.set('order', 'created_at.desc')

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
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    const row = parseRows(raw)[0]

    if (row === undefined) {
      throw new ServiceUnavailableError('Supabase не вернул обновлённую запись.')
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
      headers: {
        apikey: this.#anonKey,
        authorization: `Bearer ${this.#anonKey}`,
        accept: 'application/json',
        prefer: 'return=minimal',
      },
    })

    if (!response.ok) {
      const raw = await response.text()

      throw new ServiceUnavailableError(summarizeSupabaseError(response.status, raw))
    }

    return true
  }
}

/** Экранирует символы шаблона `ilike`, чтобы адрес искался буквально. */
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

function summarizeSupabaseError(status: number, raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)

    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as { readonly message?: unknown; readonly hint?: unknown }
      const message = typeof record.message === 'string' ? record.message : raw
      const hint = typeof record.hint === 'string' ? ` ${record.hint}` : ''

      return `Supabase ${String(status)}: ${message}${hint}`
    }
  } catch {
    /* Текст ответа не JSON — отдаём как есть, обрезав длину. */
  }

  const clipped = raw.trim() === '' ? '(empty body)' : raw.slice(0, 300)

  return `Supabase ${String(status)}: ${clipped}`
}
