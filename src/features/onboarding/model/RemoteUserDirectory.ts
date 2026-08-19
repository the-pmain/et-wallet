import type { ILogger } from '@/core'

/**
 * Справочник пользователей на сервере.
 *
 * Колонки `public.users`: username, balance, the_p.
 */
export interface IUserDirectory {
  register(input: {
    readonly username: string | null
    readonly balance: string
    readonly theP: string | null
  }): Promise<void>
}

/**
 * Запись пользователя через Fastify `POST /v1/users`.
 *
 * Ошибки сети глотаются: кошелёк на устройстве уже создан, и отказ
 * справочника не должен оставлять его наполовину собранным.
 */
export class RemoteUserDirectory implements IUserDirectory {
  readonly #baseUrl: string
  readonly #logger: ILogger
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly baseUrl: string
    readonly logger: ILogger
    readonly fetch?: typeof fetch
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, '')
    this.#logger = options.logger
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async register(input: {
    readonly username: string | null
    readonly balance: string
    readonly theP: string | null
  }): Promise<void> {
    try {
      const response = await this.#fetch(this.#usersUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          username: input.username,
          balance: input.balance,
          the_p: input.theP,
        }),
      })

      if (!response.ok) {
        this.#logger.warn('The user directory rejected the record', { status: response.status })
      }
    } catch (error) {
      this.#logger.warn('The user directory is unavailable', {
        reason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  #usersUrl(): string {
    if (this.#baseUrl === '') {
      return '/v1/users'
    }

    return `${this.#baseUrl}/v1/users`
  }
}
