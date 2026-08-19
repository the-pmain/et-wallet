import { ServiceUnavailableError } from '../lib/errors.ts'

import type { ICreateUserInput, IUserRecord, IUsersRepository } from './contracts.ts'

/** Строка, которую возвращает PostgREST. */
interface IUserRow {
  readonly id: string | number
  readonly created_at: string
  readonly username: string | null
  readonly balance: string | null
  readonly the_p?: string | null
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
        username: input.username,
        balance: input.balance,
        the_p: input.theP,
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

    return {
      id: String(row.id),
      createdAt: new Date(row.created_at),
      username: row.username,
      balance: row.balance,
      theP: row.the_p ?? input.theP,
    }
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
