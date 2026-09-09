import {
  parseRemoteReceiving,
  parseRemoteSending,
  type IRemoteAssetToken,
  type IRemoteAssets,
  type IRemoteReceiving,
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

export interface IAdminSendingCreate {
  readonly userId: string
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
  readonly status?: SendingStatus
  readonly failureMessage?: string | null
}

export interface IAdminSendingPatch {
  readonly status: SendingStatus
  readonly failureMessage: string | null
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}

export interface IAdminReceivingCreate {
  readonly userId: string
  readonly status: SendingStatus
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

export interface IAdminReceivingPatch {
  readonly status: SendingStatus
  readonly failureMessage: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

export interface IAdminUserPatch {
  readonly email?: string
  readonly balance?: string
  readonly theP?: string
  readonly wallets?: IUserWalletsMap
  readonly assets?: IRemoteAssets
}

export interface IAdminLogin {
  readonly id: string
  readonly createdAt: string
  readonly timeZone: string | null
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly countryCode: string | null
}

export interface IAdminUserActivity {
  readonly userId: string
  readonly email: string | null
  readonly loginCount: number
  readonly logins: readonly IAdminLogin[]
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

  async listLoginActivity(): Promise<readonly IAdminUserActivity[]> {
    const response = await this.#request('/v1/admin/login-events', { method: 'GET' })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list login activity failed')
    }

    const users = parseLoginActivityList(payload)

    if (users === null) {
      throw new AdminAuthError(
        response.status,
        'list login activity returned an unexpected response',
      )
    }

    return users
  }

  async listUserSendings(userId: string): Promise<readonly IRemoteSending[]> {
    const response = await this.#request(`/v1/admin/users/${encodeURIComponent(userId)}/sendings`, {
      method: 'GET',
    })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list user sendings failed')
    }

    const sendings = parseSendingList(payload)

    if (sendings === null) {
      throw new AdminAuthError(
        response.status,
        'list user sendings returned an unexpected response',
      )
    }

    return sendings
  }

  async createSending(input: IAdminSendingCreate): Promise<IRemoteSending> {
    const response = await this.#request('/v1/admin/sendings', {
      method: 'POST',
      body: {
        userId: input.userId,
        recipientAddress: input.recipientAddress,
        amount: input.amount,
        symbol: input.symbol,
        ...(input.status === undefined ? {} : { status: input.status }),
        failureMessage: input.failureMessage ?? null,
      },
    })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'create sending failed')
    }

    const sending = parseRemoteSending(payload)

    if (sending === null) {
      throw new AdminAuthError(response.status, 'create sending returned an unexpected response')
    }

    return sending
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

  async listUserReceivings(userId: string): Promise<readonly IRemoteReceiving[]> {
    const response = await this.#request(
      `/v1/admin/users/${encodeURIComponent(userId)}/receivings`,
      {
        method: 'GET',
      },
    )
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list user receivings failed')
    }

    const receivings = parseReceivingList(payload)

    if (receivings === null) {
      throw new AdminAuthError(
        response.status,
        'list user receivings returned an unexpected response',
      )
    }

    return receivings
  }

  async listReceivings(): Promise<readonly IRemoteReceiving[]> {
    const response = await this.#request('/v1/admin/receivings', { method: 'GET' })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'list receivings failed')
    }

    const receivings = parseReceivingList(payload)

    if (receivings === null) {
      throw new AdminAuthError(response.status, 'list receivings returned an unexpected response')
    }

    return receivings
  }

  async createReceiving(input: IAdminReceivingCreate): Promise<IRemoteReceiving> {
    const response = await this.#request('/v1/admin/receivings', {
      method: 'POST',
      body: {
        userId: input.userId,
        status: input.status,
        failureMessage: input.failureMessage ?? null,
        recipientAddress: input.recipientAddress ?? null,
        amount: input.amount,
        symbol: input.symbol,
        usdAmount: input.usdAmount ?? null,
      },
    })
    const payload = parseJson(await response.text())

    if (!response.ok) {
      throw this.#failure(response.status, 'create receiving failed')
    }

    const receiving = parseRemoteReceiving(payload)

    if (receiving === null) {
      throw new AdminAuthError(response.status, 'create receiving returned an unexpected response')
    }

    return receiving
  }

  async updateReceiving(id: string, patch: IAdminReceivingPatch): Promise<IRemoteReceiving> {
    const response = await this.#request(`/v1/admin/receivings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        status: patch.status,
        failureMessage: patch.failureMessage,
        recipientAddress: patch.recipientAddress ?? null,
        amount: patch.amount,
        symbol: patch.symbol,
        usdAmount: patch.usdAmount ?? null,
      },
    })
    const payload = parseJson(await response.text())

    if (response.status === 404) {
      throw new AdminAuthError(404, 'receiving not found')
    }

    if (!response.ok) {
      throw this.#failure(response.status, 'update receiving failed')
    }

    const receiving = parseRemoteReceiving(payload)

    if (receiving === null) {
      throw new AdminAuthError(response.status, 'update receiving returned an unexpected response')
    }

    return receiving
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

function parseLoginActivityList(payload: unknown): readonly IAdminUserActivity[] | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const users = (payload as Record<string, unknown>)['users']

  if (!Array.isArray(users)) {
    return null
  }

  const parsed: IAdminUserActivity[] = []

  for (const item of users) {
    const row = parseLoginActivity(item)

    if (row === null) {
      return null
    }

    parsed.push(row)
  }

  return parsed
}

function parseLoginActivity(payload: unknown): IAdminUserActivity | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const userId = record['userId']
  const email = record['email']
  const loginCount = record['loginCount']
  const logins = record['logins']

  if (typeof userId !== 'string' || userId === '') {
    return null
  }

  if (typeof email !== 'string' && email !== null) {
    return null
  }

  if (typeof loginCount !== 'number' || !Number.isFinite(loginCount) || loginCount < 0) {
    return null
  }

  if (!Array.isArray(logins)) {
    return null
  }

  const parsed: IAdminLogin[] = []

  for (const item of logins) {
    const login = parseLogin(item)

    if (login === null) {
      return null
    }

    parsed.push(login)
  }

  return {
    userId,
    email,
    loginCount,
    logins: parsed,
  }
}

function parseLogin(payload: unknown): IAdminLogin | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const id = record['id']
  const createdAt = record['createdAt']

  if (typeof id !== 'string' || id === '' || typeof createdAt !== 'string') {
    return null
  }

  return {
    id,
    createdAt,
    timeZone: readNullableString(record['timeZone']),
    city: readNullableString(record['city']),
    region: readNullableString(record['region']),
    country: readNullableString(record['country']),
    countryCode: readNullableString(record['countryCode']),
  }
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

function parseReceivingList(payload: unknown): readonly IRemoteReceiving[] | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const receivings = (payload as Record<string, unknown>)['receivings']

  if (!Array.isArray(receivings)) {
    return null
  }

  const parsed: IRemoteReceiving[] = []

  for (const item of receivings) {
    const receiving = parseRemoteReceiving(item)

    if (receiving === null) {
      return null
    }

    parsed.push(receiving)
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
