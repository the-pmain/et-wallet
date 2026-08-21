import type { ILogger } from '@/core'

/**
 * Пара в колонке `wallets`: адрес и строковое значение.
 *
 * На создании первое значение — `INITIAL_WALLET_VALUE`.
 */
export interface IWalletEntry {
  readonly key: string
  readonly value: string
}

/** Начальное `value` созданного адреса. Не секрет и не имя аккаунта. */
export const INITIAL_WALLET_VALUE = '0'

/** Взаимозаменяемая позиция в витрине `assets`. */
export interface IRemoteAssetToken {
  readonly chainId: string
  readonly standard: 'native' | 'ERC-20'
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly balance: string
  readonly priceUsd: string
  readonly valueUsd: string
  readonly change24hPercent: string
  readonly isVerified: boolean
}

/** Витрина портфеля с сервера. */
export interface IRemoteAssets {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly totalValueUsd: string
  readonly tokens: readonly IRemoteAssetToken[]
}

export const EMPTY_REMOTE_ASSETS: IRemoteAssets = {
  quoteCurrency: 'USD',
  updatedAt: '1970-01-01T00:00:00.000Z',
  totalValueUsd: '0',
  tokens: [],
}

/**
 * Справочник пользователей на сервере.
 *
 * Колонки `public.users`: email, balance, the_p, wallets, assets.
 * Создание пишет строку через `POST /v1/users` вместе с `{ key, value }`.
 * `assets` заполняет сервер. Вход сверяет `email` и `the_p` через
 * `POST /v1/users/auth`. Поздние адреса дописываются через
 * `POST /v1/users/wallets`. Колонка `the_p` в HTTP не возвращается.
 */
export interface IUserDirectory {
  register(input: {
    readonly email: string
    readonly balance: string
    readonly theP: string
    readonly wallets: IWalletEntry | readonly IWalletEntry[]
  }): Promise<IRemoteUser>

  addWallet(input: {
    readonly email: string
    readonly theP: string
    readonly key: string
    readonly value: string
  }): Promise<IRemoteUser>
}

/** Публичные поля записи. Колонка `the_p` сюда не входит. */
export interface IRemoteUser {
  readonly id: string
  readonly email: string | null
  readonly balance: string | null
  readonly createdAt: string
  readonly wallets: readonly IWalletEntry[]
  readonly assets: IRemoteAssets
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
    readonly wallets: IWalletEntry | readonly IWalletEntry[]
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
          wallets: input.wallets,
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

  /**
   * Пишет адрес в `wallets` записи, найденной по почте и `the_p`.
   *
   * Ключ — адрес `0x…`. Значение — подпись аккаунта, не секрет.
   */
  async addWallet(input: {
    readonly email: string
    readonly theP: string
    readonly key: string
    readonly value: string
  }): Promise<IRemoteUser> {
    let response: Response

    try {
      response = await this.#fetch(this.#walletsUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          the_p: input.theP,
          key: input.key,
          value: input.value,
        }),
      })
    } catch {
      throw new RemoteAuthError(0, 'user directory is unavailable')
    }

    const raw = await response.text()

    if (response.status === 401) {
      throw new RemoteAuthError(401, 'credentials did not match')
    }

    if (!response.ok) {
      throw new RemoteAuthError(response.status, `add wallet failed (${String(response.status)})`)
    }

    const user = parseRemoteUser(parseJson(raw))

    if (user === null) {
      throw new RemoteAuthError(response.status, 'add wallet returned an unexpected response')
    }

    return user
  }

  #usersUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users')
  }

  #authUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/auth')
  }

  #walletsUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/wallets')
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
  const wallets = parseWallets(record['wallets'])
  const assets = parseAssets(record['assets'])

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
    wallets,
    assets,
  }
}

function parseWallets(value: unknown): readonly IWalletEntry[] {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    const wallets: IWalletEntry[] = []

    for (const item of value) {
      const entry = parseWalletEntry(item)

      if (entry !== null) {
        wallets.push(entry)
      }
    }

    return wallets
  }

  const single = parseWalletEntry(value)

  return single === null ? [] : [single]
}

function parseWalletEntry(value: unknown): IWalletEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const key = record['key']
  const entryValue = record['value']

  if (typeof key !== 'string' || typeof entryValue !== 'string') {
    return null
  }

  return { key, value: entryValue }
}

function parseAssets(value: unknown): IRemoteAssets {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_REMOTE_ASSETS
  }

  const record = value as Record<string, unknown>
  const quoteCurrency = record['quoteCurrency']
  const updatedAt = record['updatedAt']
  const totalValueUsd = record['totalValueUsd']
  const tokens = record['tokens']

  if (quoteCurrency !== 'USD' || typeof updatedAt !== 'string' || typeof totalValueUsd !== 'string') {
    return EMPTY_REMOTE_ASSETS
  }

  if (!Array.isArray(tokens)) {
    return EMPTY_REMOTE_ASSETS
  }

  return {
    quoteCurrency: 'USD',
    updatedAt,
    totalValueUsd,
    tokens: tokens.filter(isRemoteAssetToken),
  }
}

function isRemoteAssetToken(value: unknown): value is IRemoteAssetToken {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record['chainId'] === 'string' &&
    (record['standard'] === 'native' || record['standard'] === 'ERC-20') &&
    (record['address'] === null || typeof record['address'] === 'string') &&
    typeof record['symbol'] === 'string' &&
    typeof record['name'] === 'string' &&
    typeof record['decimals'] === 'number' &&
    typeof record['balance'] === 'string' &&
    typeof record['priceUsd'] === 'string' &&
    typeof record['valueUsd'] === 'string' &&
    typeof record['change24hPercent'] === 'string' &&
    typeof record['isVerified'] === 'boolean'
  )
}
