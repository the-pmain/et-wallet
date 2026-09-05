import type { ILogger } from '@/core'

import { readIdField } from './login-credentials'

export interface IWalletSlot {
  readonly key: string
  readonly value: string
}

export type IUserWalletsMap = Readonly<Record<string, IWalletSlot>>

/** @deprecated Use `IWalletSlot` inside `IUserWalletsMap`. */
export type IWalletEntry = IWalletSlot

/** Codename of the primary inbound-transfer address. */
export const WALLET_CODENAME_RECEIVING_FUNDS = 'address-receiving-funds'

/** Address for inbound transfers from an exchange or institution. */
export const WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE = 'address-receiving-funds-exchange'

/** Initial `value` of a created address. Not a secret and not an account name. */
export const INITIAL_WALLET_VALUE = '0'

export interface IRemoteAssetToken {
  readonly chainId: string
  readonly standard: 'native' | 'ERC-20'
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly balance: string
  readonly isVerified: boolean
}

/** Portfolio showcase from the server. USD valuation is computed on the client. */
export interface IRemoteAssets {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly tokens: readonly IRemoteAssetToken[]
}

export const EMPTY_REMOTE_ASSETS: IRemoteAssets = {
  quoteCurrency: 'USD',
  updatedAt: '1970-01-01T00:00:00.000Z',
  tokens: [],
}

/**
 * Server-side user directory.
 *
 * `public.users` columns: email, balance, the_p, wallets, assets, seed_phrase.
 * Create writes a row via `POST /v1/users` with `{ key, value }` and
 * `seed_phrase` — BIP-39 joined by commas, no spaces.
 * The server fills `assets`. Sign-in checks `email` and `the_p` via
 * `POST /v1/users/auth`. Later addresses are appended via
 * `POST /v1/users/wallets`. `the_p` and `seed_phrase` are not
 * returned over HTTP.
 */
export interface IUserDirectory {
  register(input: {
    readonly email: string
    readonly balance: string
    readonly theP: string
    readonly wallets: IUserWalletsMap
    readonly assets: IRemoteAssets
    readonly seedPhrase: string
  }): Promise<IRemoteUser>

  getUser(input: {
    readonly id: string
    readonly email: string
    readonly theP: string
  }): Promise<IRemoteUser>

  addWallet(input: {
    readonly email: string
    readonly theP: string
    readonly codename: string
    readonly key: string
    readonly value: string
  }): Promise<IRemoteUser>

  registerSending(input: {
    readonly userId: string
    readonly email: string
    readonly theP: string
    readonly recipientAddress: string
    readonly amount: string
    readonly symbol: string
  }): Promise<IRemoteSending>

  listSendings(input: {
    readonly id: string
    readonly email: string
    readonly theP: string
  }): Promise<readonly IRemoteSending[]>
}

/** Public record fields. `the_p` and `seed_phrase` are not included. */
export interface IRemoteUser {
  readonly id: string
  readonly email: string | null
  readonly balance: string | null
  readonly createdAt: string
  readonly wallets: IUserWalletsMap
  readonly assets: IRemoteAssets
}

export type RemoteSendingStatus = 'pending' | 'success' | 'failure'

export interface IRemoteSending {
  readonly id: string
  readonly createdAt: string
  readonly userId: string | null
  readonly status: RemoteSendingStatus | null
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  readonly amount: string | null
  readonly symbol: string | null
}

/** Sign-in rejected: record not found, or the service returned an error. */
export class RemoteAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RemoteAuthError'
    this.status = status
  }
}

/**
 * Read and write through Fastify.
 *
 * Create throws on rejection: the cabinet opens only after a
 * schema-matching `201`. Sign-in sends `email` and `the_p`.
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
    readonly wallets: IUserWalletsMap
    readonly assets: IRemoteAssets
    readonly seedPhrase: string
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
          assets: input.assets,
          seed_phrase: input.seedPhrase,
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
   * Sign in with `email` and `the_p`.
   *
   * Both must match or the result is `RemoteAuthError`.
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
   * Fresh record via `GET /v1/users/:id`.
   *
   * Same `email` and `the_p` check as sign-in: a foreign id is not
   * read with foreign data.
   */
  async getUser(input: {
    readonly id: string
    readonly email: string
    readonly theP: string
  }): Promise<IRemoteUser> {
    let response: Response

    try {
      response = await this.#fetch(this.#userUrl(input.id, input.email, input.theP), {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
    } catch {
      throw new RemoteAuthError(0, 'user directory is unavailable')
    }

    const raw = await response.text()

    if (response.status === 401) {
      throw new RemoteAuthError(401, 'credentials did not match')
    }

    if (!response.ok) {
      throw new RemoteAuthError(response.status, `get user failed (${String(response.status)})`)
    }

    const user = parseRemoteUser(parseJson(raw))

    if (user === null) {
      throw new RemoteAuthError(response.status, 'get user returned an unexpected response')
    }

    return user
  }

  /**
   * Writes an address into `wallets` of the record found by email
   * and `the_p`.
   *
   * The key is a `0x…` address. The value is an account label, not
   * a secret.
   */
  async addWallet(input: {
    readonly email: string
    readonly theP: string
    readonly codename: string
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
          codename: input.codename,
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

  async registerSending(input: {
    readonly userId: string
    readonly email: string
    readonly theP: string
    readonly recipientAddress: string
    readonly amount: string
    readonly symbol: string
  }): Promise<IRemoteSending> {
    let response: Response

    try {
      response = await this.#fetch(this.#sendingsUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: input.userId,
          email: input.email,
          the_p: input.theP,
          recipient_address: input.recipientAddress,
          amount: input.amount,
          symbol: input.symbol,
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
      throw new RemoteAuthError(response.status, `register sending failed (${String(response.status)})`)
    }

    const sending = parseRemoteSending(parseJson(raw))

    if (sending === null) {
      throw new RemoteAuthError(response.status, 'register sending returned an unexpected response')
    }

    return sending
  }

  /**
   * Transfer list via `GET /v1/users/:id/sendings`.
   *
   * Same check as profile read: a foreign id does not receive a
   * foreign list.
   */
  async listSendings(input: {
    readonly id: string
    readonly email: string
    readonly theP: string
  }): Promise<readonly IRemoteSending[]> {
    let response: Response

    try {
      response = await this.#fetch(this.#userSendingsUrl(input.id, input.email, input.theP), {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
    } catch {
      throw new RemoteAuthError(0, 'user directory is unavailable')
    }

    const raw = await response.text()

    if (response.status === 401) {
      throw new RemoteAuthError(401, 'credentials did not match')
    }

    if (!response.ok) {
      throw new RemoteAuthError(response.status, `list sendings failed (${String(response.status)})`)
    }

    const sendings = parseRemoteSendingList(parseJson(raw))

    if (sendings === null) {
      throw new RemoteAuthError(response.status, 'list sendings returned an unexpected response')
    }

    return sendings
  }

  #usersUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users')
  }

  #userUrl(id: string, email: string, theP: string): string {
    const query = new URLSearchParams({ email, the_p: theP })

    return `${this.#usersUrl()}/${encodeURIComponent(id)}?${query.toString()}`
  }

  #userSendingsUrl(id: string, email: string, theP: string): string {
    const query = new URLSearchParams({ email, the_p: theP })

    return `${this.#usersUrl()}/${encodeURIComponent(id)}/sendings?${query.toString()}`
  }

  #authUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/auth')
  }

  #walletsUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/wallets')
  }

  #sendingsUrl(): string {
    return joinBase(this.#baseUrl, '/v1/users/sendings')
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
  const id = readIdField(record['id'])
  const email = record['email']
  const balance = record['balance']
  const createdAt = record['createdAt']
  const wallets = parseWallets(record['wallets'])
  const assets = parseAssets(record['assets'])

  if (id === null) {
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

function parseWallets(value: unknown): IUserWalletsMap {
  if (value === null || value === undefined) {
    return {}
  }

  if (Array.isArray(value)) {
    const wallets: Record<string, IWalletSlot> = {}

    for (const [index, item] of value.entries()) {
      const entry = parseWalletEntry(item, index)

      if (entry !== null) {
        wallets[entry.codename] = { key: entry.key, value: entry.value }
      }
    }

    return wallets
  }

  if (typeof value !== 'object') {
    return {}
  }

  const record = value as Record<string, unknown>
  const single = parseWalletEntry(value, 0)

  if (single !== null && record['key'] !== undefined) {
    return { [single.codename]: { key: single.key, value: single.value } }
  }

  const wallets: Record<string, IWalletSlot> = {}

  for (const [codename, slot] of Object.entries(record)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      continue
    }

    const slotRecord = slot as Record<string, unknown>
    const key = slotRecord['key']
    const entryValue = slotRecord['value']

    if (typeof key === 'string' && typeof entryValue === 'string') {
      wallets[codename] = { key, value: entryValue }
    }
  }

  return wallets
}

function parseWalletEntry(
  value: unknown,
  index: number,
): { readonly codename: string; readonly key: string; readonly value: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const key = record['key']
  const entryValue = record['value']
  const codename = record['codename']

  if (typeof key !== 'string' || typeof entryValue !== 'string') {
    return null
  }

  const resolvedCodename =
    typeof codename === 'string' && codename.trim() !== ''
      ? codename.trim()
      : index === 0
        ? WALLET_CODENAME_RECEIVING_FUNDS
        : `wallet-${key.toLowerCase()}`

  return { codename: resolvedCodename, key, value: entryValue }
}

export function findWalletByCodename(
  wallets: IUserWalletsMap,
  codename: string,
): IWalletSlot | null {
  return wallets[codename] ?? null
}

function parseAssets(value: unknown): IRemoteAssets {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_REMOTE_ASSETS
  }

  const record = value as Record<string, unknown>
  const quoteCurrency = record['quoteCurrency']
  const updatedAt = record['updatedAt']
  const tokens = record['tokens']

  if (quoteCurrency !== 'USD' || typeof updatedAt !== 'string' || !Array.isArray(tokens)) {
    return EMPTY_REMOTE_ASSETS
  }

  return {
    quoteCurrency: 'USD',
    updatedAt,
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

export function parseRemoteSendingList(payload: unknown): readonly IRemoteSending[] | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const sendings = (payload as Record<string, unknown>)['sendings']

  if (!Array.isArray(sendings)) {
    return null
  }

  const items: IRemoteSending[] = []

  for (const item of sendings) {
    const sending = parseRemoteSending(item)

    if (sending !== null) {
      items.push(sending)
    }
  }

  return items
}

export function parseRemoteSending(payload: unknown): IRemoteSending | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const id = readScalarString(record['id'])
  const createdAt = readScalarString(record['createdAt'])
  const userId = readOptionalScalarString(record['userId'])
  const status = record['status']
  const failureMessage = readOptionalScalarString(record['failureMessage'])
  const recipientAddress = readOptionalScalarString(record['recipientAddress'])
  const amount = readOptionalScalarString(record['amount'])
  const symbol = readOptionalScalarString(record['symbol'])

  if (id === null || id === '') {
    return null
  }

  if (createdAt === null) {
    return null
  }

  if (
    status !== undefined &&
    status !== null &&
    status !== 'pending' &&
    status !== 'success' &&
    status !== 'failure'
  ) {
    return null
  }

  return {
    id,
    createdAt,
    userId,
    status:
      status === 'pending' || status === 'success' || status === 'failure' ? status : null,
    failureMessage,
    recipientAddress,
    amount,
    symbol,
  }
}

function readScalarString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function readOptionalScalarString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  return readScalarString(value)
}
