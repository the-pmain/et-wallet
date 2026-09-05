import {
  parseRemoteSending,
  type IRemoteAssetToken,
  type IRemoteAssets,
  type IRemoteSending,
  type IRemoteUser,
  type IUserWalletsMap,
  type IWalletSlot,
} from '@/features/onboarding/model/RemoteUserDirectory'
import type { SendingStatus } from '@/features/onboarding/model/sending-status'

import { parseAdminRole, type AdminRole } from './admin-role'

const EMPTY_ASSETS: IRemoteAssets = {
  quoteCurrency: 'USD',
  updatedAt: '1970-01-01T00:00:00.000Z',
  tokens: [],
}

/**
 * Admin cabinet client.
 *
 * The PIN lives only in the `x-admin-pin` header. The server checks
 * it against `ADMIN_PIN` or `SUPER_ADMIN_PIN`; the client does not
 * know the PIN in advance.
 */

export class AdminAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminAuthError'
    this.status = status
  }
}

export interface IAdminSendingPatch {
  readonly status: SendingStatus
  readonly failureMessage: string | null
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}

export interface IAdminUserPatch {
  readonly email?: string
  readonly balance?: string
  readonly theP?: string
  readonly wallets?: IUserWalletsMap
  readonly assets?: IRemoteAssets
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

  async authenticate(pin: string): Promise<AdminRole> {
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

    const role = parseAdminAuthRole(parseJson(await response.text()))

    if (role === null) {
      throw new AdminAuthError(response.status, 'admin auth returned an unexpected response')
    }

    this.#pin = pin

    return role
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

  async listSendings(): Promise<readonly IRemoteSending[]> {
    const response = await this.#request('/v1/admin/sendings', { method: 'GET' })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list sendings failed')
    }

    const sendings = parseSendingList(payload)

    if (sendings === null) {
      throw new AdminAuthError(response.status, 'list sendings returned an unexpected response')
    }

    return sendings
  }

  async updateSending(id: string, patch: IAdminSendingPatch): Promise<IRemoteSending> {
    const response = await this.#request(`/v1/admin/sendings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        status: patch.status,
        failureMessage: patch.failureMessage,
        recipientAddress: patch.recipientAddress,
        amount: patch.amount,
        symbol: patch.symbol,
      },
    })
    const payload = parseJson(await response.text())

    if (response.status === 404) {
      throw new AdminAuthError(404, 'sending not found')
    }

    if (!response.ok) {
      throw this.#failure(response.status, 'update sending failed')
    }

    const sending = parseRemoteSending(payload)

    if (sending === null) {
      throw new AdminAuthError(response.status, 'update sending returned an unexpected response')
    }

    return sending
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

function parseAdminAuthRole(payload: unknown): AdminRole | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  return parseAdminRole((payload as Record<string, unknown>)['role'])
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

function parseSendingList(payload: unknown): readonly IRemoteSending[] | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const sendings = (payload as Record<string, unknown>)['sendings']

  if (!Array.isArray(sendings)) {
    return null
  }

  const parsed: IRemoteSending[] = []

  for (const item of sendings) {
    const sending = parseRemoteSending(item)

    if (sending === null) {
      return null
    }

    parsed.push(sending)
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

function parseWallets(value: unknown): IUserWalletsMap {
  if (value === null || value === undefined) {
    return {}
  }

  if (Array.isArray(value)) {
    const wallets: Record<string, IWalletSlot> = {}

    for (const [index, item] of value.entries()) {
      if (item === null || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const key = record['key']
      const entryValue = record['value']
      const codename = record['codename']

      if (typeof key === 'string' && typeof entryValue === 'string') {
        const resolvedCodename =
          typeof codename === 'string' && codename.trim() !== ''
            ? codename.trim()
            : index === 0
              ? 'address-receiving-funds'
              : `wallet-${key.toLowerCase()}`

        wallets[resolvedCodename] = { key, value: entryValue }
      }
    }

    return wallets
  }

  if (typeof value !== 'object') {
    return {}
  }

  const wallets: Record<string, IWalletSlot> = {}

  for (const [codename, slot] of Object.entries(value as Record<string, unknown>)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      continue
    }

    const record = slot as Record<string, unknown>
    const key = record['key']
    const entryValue = record['value']

    if (typeof key === 'string' && typeof entryValue === 'string') {
      wallets[codename] = { key, value: entryValue }
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
