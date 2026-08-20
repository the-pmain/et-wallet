import type { ILogger } from '@/core'

/**
 * Справочник пользователей на сервере.
 *
 * Колонки `public.users`: email, balance, the_p.
 * Создание пишет строку через `POST /v1/users`. Вход сверяет
 * `email` и `the_p` через `POST /v1/users/auth`. Колонка `the_p`
 * в HTTP не возвращается.
 */
export interface IUserDirectory {
  register(input: {
    readonly email: string
    readonly balance: string
    readonly theP: string
  }): Promise<IRemoteUser>
}

/** Публичные поля записи. Колонка `the_p` сюда не входит. */
export interface IRemoteUser {
  readonly id: string
  readonly email: string | null
  readonly balance: string | null
  readonly createdAt: string
}

/** Отказ входа: запись не найдена, либо сервис ответил ошибкой. */
export class RemoteAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RemoteAuthError'
    this.status = status
  }
}

/**
 * Запись и чтение через Fastify.
 *
 * Создание бросает при отказе: кабинет открывается только после
 * ответа `201`, соответствующего схеме. Вход шлёт `email` и `the_p`.
 */
export class RemoteUserDirectory implements IUserDirectory {
  readonly #baseUrl: string
  readonly #logger: ILogger | null
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly baseUrl: string
    readonly logger?: ILogger
    readonly fetch?: typeof fetch
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, '')
    this.#logger = options.logger ?? null
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async register(input: {
    readonly email: string
    readonly balance: string
    readonly theP: string
  }): Promise<IRemoteUser> {
    let response: Response

    try {
      response = await this.#fetch(this.#usersUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          balance: input.balance,
          the_p: input.theP,
        }),
      })
    } catch (error) {
      this.#logger?.warn('The user directory is unavailable', {
        reason: error instanceof Error ? error.message : 'unknown',
      })
      throw new RemoteAuthError(0, 'user directory is unavailable')
    }

    const raw = await response.text()

    if (!response.ok) {
      this.#logger?.warn('The user directory rejected the record', { status: response.status })
      throw new RemoteAuthError(response.status, `register failed (${String(response.status)})`)
    }

    const user = parseRemoteUser(parseJson(raw))

    if (user === null) {
      throw new RemoteAuthError(response.status, 'register returned an unexpected response')
    }

    return user
  }

  /**
   * Вход по `email` и `the_p`.
   *
   * Совпадение обоих — данные записи. Иначе `RemoteAuthError`.
   */
  async authenticate(input: {
    readonly email: string
    readonly theP: string
  }): Promise<IRemoteUser> {
    let response: Response

    try {
      response = await this.#fetch(this.#authUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ email: input.email, the_p: input.theP }),
      })
    } catch {
      throw new RemoteAuthError(0, 'user directory is unavailable')
    }

    const raw = await response.text()

    if (response.status === 401) {
      throw new RemoteAuthError(401, 'credentials did not match')
    }

    if (!response.ok) {
      throw new RemoteAuthError(response.status, `auth failed (${String(response.status)})`)
    }

    const user = parseRemoteUser(parseJson(raw))

    if (user === null) {
      throw new RemoteAuthError(response.status, 'auth returned an unexpected response')
    }

    return user
  }

  #usersUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users')
  }

  #authUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/auth')
  }
}

function joinBase(baseUrl: string, path: string): string {
  if (baseUrl === '') {
    return path
  }

  return `${baseUrl}${path}`
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseRemoteUser(payload: unknown): IRemoteUser | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const id = record['id']
  const email = record['email']
  const balance = record['balance']
  const createdAt = record['createdAt']

  if (typeof id !== 'string' || id === '') {
    return null
  }

  if (typeof email !== 'string' && email !== null) {
    return null
  }

  if (typeof balance !== 'string' && balance !== null) {
    return null
  }

  if (typeof createdAt !== 'string') {
    return null
  }

  return {
    id,
    email,
    balance,
    createdAt,
  }
}
