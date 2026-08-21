import type {
  IRemoteAssetToken,
  IRemoteAssets,
  IRemoteUser,
  IWalletEntry,
} from '@/features/onboarding/model/RemoteUserDirectory'

const EMPTY_ASSETS: IRemoteAssets = {
  quoteCurrency: 'USD',
  updatedAt: '1970-01-01T00:00:00.000Z',
  tokens: [],
}

/**
 * Клиент кабинета администратора.
 *
 * PIN живёт только в заголовке `x-admin-pin`. Сервер сверяет его
 * с зашитым значением; клиент PIN не знает заранее.
 */

export class AdminAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminAuthError'
    this.status = status
  }
}

export interface IAdminUserPatch {
  readonly email?: string
  readonly balance?: string
  readonly theP?: string
  readonly wallets?: readonly IWalletEntry[]
  readonly assets?: IRemoteAssets
}

export interface IAdminEmailDraft {
  readonly to: string
  readonly from: string
  readonly subject: string
  readonly html: string
  readonly text?: string
}

export interface IAdminEmailStatus {
  readonly configured: boolean
}

export interface IAdminEmailSendResult {
  readonly delivered: readonly string[]
  readonly queued: readonly string[]
  readonly permanentBounces: readonly string[]
}

export class AdminClient {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch
  #pin: string | null

  constructor(options: {
    readonly baseUrl: string
    readonly pin?: string | null
    readonly fetch?: typeof fetch
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, '')
    this.#pin = options.pin ?? null
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  setPin(pin: string): void {
    this.#pin = pin
  }

  clearPin(): void {
    this.#pin = null
  }

  async authenticate(pin: string): Promise<void> {
    const response = await this.#request('/v1/admin/auth', {
      method: 'POST',
      pin,
      body: { pin },
    })

    if (response.status === 401) {
      throw new AdminAuthError(401, 'pin did not match')
    }

    if (!response.ok) {
      throw new AdminAuthError(response.status, `admin auth failed (${String(response.status)})`)
    }

    this.#pin = pin
  }

  async listUsers(): Promise<readonly IRemoteUser[]> {
    const response = await this.#request('/v1/admin/users', { method: 'GET' })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list users failed')
    }

    const users = parseUserList(payload)

    if (users === null) {
      throw new AdminAuthError(response.status, 'list users returned an unexpected response')
    }

    return users
  }

  async getUser(id: string): Promise<IRemoteUser> {
    const response = await this.#request(`/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'GET',
    })
    const payload = parseJson(await response.text())

    if (response.status === 404) {
      throw new AdminAuthError(404, 'user not found')
    }

    if (!response.ok) {
      throw this.#failure(response.status, 'get user failed')
    }

    const user = parseRemoteUser(payload)

    if (user === null) {
      throw new AdminAuthError(response.status, 'get user returned an unexpected response')
    }

    return user
  }

  async updateUser(id: string, patch: IAdminUserPatch): Promise<IRemoteUser> {
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
      body['assets'] = patch.assets
    }

    const response = await this.#request(`/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    })
    const payload = parseJson(await response.text())

    if (response.status === 404) {
      throw new AdminAuthError(404, 'user not found')
    }

    if (!response.ok) {
      throw this.#failure(response.status, 'update user failed')
    }

    const user = parseRemoteUser(payload)

    if (user === null) {
      throw new AdminAuthError(response.status, 'update user returned an unexpected response')
    }

    return user
  }

  async deleteUser(id: string): Promise<void> {
    const response = await this.#request(`/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })

    if (response.status === 404) {
      throw new AdminAuthError(404, 'user not found')
    }

    if (!response.ok) {
      throw this.#failure(response.status, 'delete user failed')
    }
  }

  async getEmailStatus(): Promise<IAdminEmailStatus> {
    const response = await this.#request('/v1/admin/email', { method: 'GET' })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'email status failed')
    }

    if (payload === null || typeof payload !== 'object') {
      throw new AdminAuthError(response.status, 'email status returned an unexpected response')
    }

    return {
      configured: (payload as Record<string, unknown>)['configured'] === true,
    }
  }

  async sendEmail(draft: IAdminEmailDraft): Promise<IAdminEmailSendResult> {
    const body: Record<string, unknown> = {
      to: draft.to,
      from: draft.from,
      subject: draft.subject,
      html: draft.html,
    }

    if (draft.text !== undefined) {
      body['text'] = draft.text
    }

    const response = await this.#request('/v1/admin/email/send', {
      method: 'POST',
      body,
    })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, readErrorMessage(payload) ?? 'send email failed')
    }

    const result = parseEmailSendResult(payload)

    if (result === null) {
      throw new AdminAuthError(response.status, 'send email returned an unexpected response')
    }

    return result
  }

  async #request(
    path: string,
    options: {
      readonly method: string
      readonly pin?: string
      readonly body?: unknown
    },
  ): Promise<Response> {
    const pin = options.pin ?? this.#pin
    const headers: Record<string, string> = { accept: 'application/json' }

    if (pin !== null) {
      headers['x-admin-pin'] = pin
    }

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    try {
      const init: RequestInit = { method: options.method, headers }

      if (options.body !== undefined) {
        init.body = JSON.stringify(options.body)
      }

      return await this.#fetch(joinBase(this.#baseUrl, path), init)
    } catch {
      throw new AdminAuthError(0, 'admin directory is unavailable')
    }
  }

  #failure(status: number, message: string): AdminAuthError {
    if (status === 401) {
      return new AdminAuthError(401, 'pin did not match')
    }

    return new AdminAuthError(status, `${message} (${String(status)})`)
  }
}

function joinBase(baseUrl: string, path: string): string {
  if (baseUrl === '') {
    return path
  }

  return `${baseUrl}${path}`
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseUserList(payload: unknown): readonly IRemoteUser[] | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const users = (payload as Record<string, unknown>)['users']

  if (!Array.isArray(users)) {
    return null
  }

  const parsed: IRemoteUser[] = []

  for (const item of users) {
    const user = parseRemoteUser(item)

    if (user === null) {
      return null
    }

    parsed.push(user)
  }

  return parsed
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
    wallets: parseWallets(record['wallets']),
    assets: parseAssets(record['assets']),
  }
}

function parseWallets(value: unknown): readonly IWalletEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  const wallets: IWalletEntry[] = []

  for (const item of value) {
    if (item === null || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const key = record['key']
    const entryValue = record['value']

    if (typeof key === 'string' && typeof entryValue === 'string') {
      wallets.push({ key, value: entryValue })
    }
  }

  return wallets
}

function parseAssets(value: unknown): IRemoteAssets {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_ASSETS
  }

  const record = value as Record<string, unknown>
  const tokens = record['tokens']

  if (record['quoteCurrency'] !== 'USD' || typeof record['updatedAt'] !== 'string') {
    return EMPTY_ASSETS
  }

  if (!Array.isArray(tokens)) {
    return EMPTY_ASSETS
  }

  return {
    quoteCurrency: 'USD',
    updatedAt: record['updatedAt'],
    tokens: tokens.flatMap((item) => {
      const token = readRemoteAssetToken(item)

      return token === null ? [] : [token]
    }),
  }
}

function readRemoteAssetToken(value: unknown): IRemoteAssetToken | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const chainId = record['chainId']
  const standard = record['standard']
  const address = record['address']
  const symbol = record['symbol']
  const name = record['name']
  const decimals = record['decimals']
  const balance = record['balance']
  const isVerified = record['isVerified']

  if (
    typeof chainId !== 'string' ||
    (standard !== 'native' && standard !== 'ERC-20') ||
    (address !== null && typeof address !== 'string') ||
    typeof symbol !== 'string' ||
    typeof name !== 'string' ||
    typeof decimals !== 'number' ||
    typeof balance !== 'string' ||
    typeof isVerified !== 'boolean'
  ) {
    return null
  }

  return {
    chainId,
    standard,
    address,
    symbol,
    name,
    decimals,
    balance,
    isVerified,
  }
}

function readErrorMessage(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const error = (payload as Record<string, unknown>)['error']

  if (error === null || typeof error !== 'object') {
    return null
  }

  const message = (error as Record<string, unknown>)['message']

  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null
}

function parseEmailSendResult(payload: unknown): IAdminEmailSendResult | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const delivered = record['delivered']
  const queued = record['queued']
  const permanentBounces = record['permanentBounces']

  if (!Array.isArray(delivered) || !Array.isArray(queued) || !Array.isArray(permanentBounces)) {
    return null
  }

  return {
    delivered: delivered.filter((item): item is string => typeof item === 'string'),
    queued: queued.filter((item): item is string => typeof item === 'string'),
    permanentBounces: permanentBounces.filter((item): item is string => typeof item === 'string'),
  }
}
