import { hasAddressShape, toChecksumAddress } from '../lib/address.ts'

/**
 * Asset snapshot in the `assets` column.
 *
 * NUMBERS ARE STRINGS. `JSON.parse` loses precision on wei.
 *
 * BALANCES ONLY. Price and dollar value are computed on the client
 * from a live source; they are not stored, so a stale amount is not
 * presented as current.
 */

export const ASSET_STANDARD = {
  Native: 'native',
  Erc20: 'ERC-20',
} as const

export type AssetStandard = (typeof ASSET_STANDARD)[keyof typeof ASSET_STANDARD]

const FUNGIBLE_STANDARDS = new Set<string>([ASSET_STANDARD.Native, ASSET_STANDARD.Erc20])

const INTEGER_STRING = /^\d+$/u
const MAX_TOKENS = 64
const SYMBOL_MAX = 32
const NAME_MAX = 128

/** Fungible holding: native currency or ERC-20. */
export interface IAssetToken {
  readonly chainId: string
  readonly standard: AssetStandard
  /** Contract address. `null` for native currency. */
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  /** Balance in smallest units. */
  readonly balance: string
  readonly isVerified: boolean
}

/** User portfolio showcase. */
export interface IUserAssets {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly tokens: readonly IAssetToken[]
}

/** Empty showcase: no assets, not "zero on the account". */
export function emptyAssets(): IUserAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: '1970-01-01T00:00:00.000Z',
    tokens: [],
  }
}

/**
 * Starting showcase for a new user.
 *
 * One holding: native ETH on Ethereum, balance `"0"`.
 * Other coins are not stored — they are added later.
 * No price, valuation, or 24h change in the record.
 */
export const STARTING_TOKENS: readonly IAssetToken[] = [
  holding('1', ASSET_STANDARD.Native, null, 'ETH', 'Ether', 18),
]

const STORED_ASSET_KEYS = ['quoteCurrency', 'updatedAt', 'tokens'] as const
const STORED_TOKEN_KEYS = [
  'chainId',
  'standard',
  'address',
  'symbol',
  'name',
  'decimals',
  'balance',
  'isVerified',
] as const

export const STORED_ASSET_FIELD_NAMES: readonly string[] = STORED_ASSET_KEYS
export const STORED_TOKEN_FIELD_NAMES: readonly string[] = STORED_TOKEN_KEYS

export function createStartingAssets(now: Date = new Date()): IUserAssets {
  return withZeroTokenBalances(
    sanitizeAssets({
      quoteCurrency: 'USD',
      updatedAt: now.toISOString(),
      tokens: STARTING_TOKENS,
    }),
  )
}

/**
 * Keeps only stored fields in the showcase.
 *
 * Drops `priceUsd`, `valueUsd`, `totalValueUsd`, `change24hPercent`.
 */
export function sanitizeAssets(assets: IUserAssets): IUserAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: assets.updatedAt,
    tokens: assets.tokens.map(sanitizeToken),
  }
}

/** Every holding balance is `"0"`, even if the request sent something else. */
export function withZeroTokenBalances(assets: IUserAssets): IUserAssets {
  return sanitizeAssets({
    quoteCurrency: 'USD',
    updatedAt: assets.updatedAt,
    tokens: assets.tokens.map((token) => ({ ...token, balance: '0' })),
  })
}

function sanitizeToken(token: IAssetToken): IAssetToken {
  return {
    chainId: token.chainId,
    standard: token.standard,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    balance: token.balance,
    isVerified: token.isVerified,
  }
}

function holding(
  chainId: string,
  standard: AssetStandard,
  address: string | null,
  symbol: string,
  name: string,
  decimals: number,
): IAssetToken {
  return {
    chainId,
    standard,
    address,
    symbol,
    name,
    decimals,
    balance: '0',
    isVerified: true,
  }
}

/**
 * Parses the `assets` column.
 *
 * A broken record does not fail login: we return an empty showcase,
 * not a rejection. Otherwise one corrupt jsonb would lock the cabinet.
 *
 * `totalValueUsd`, `priceUsd`, `valueUsd` in old rows are ignored:
 * valuation is no longer stored.
 */
export function parseAssets(value: unknown): IUserAssets {
  const parsed = readAssets(value)

  return parsed ?? emptyAssets()
}

/**
 * Parses `assets` from the request body.
 *
 * A missing field is `null`: the caller supplies the default showcase.
 * A present object must be valid as a whole.
 */
export function readAssetsPayload(value: unknown): IUserAssets | null {
  if (value === undefined) {
    return null
  }

  return readAssets(value)
}

function readAssets(value: unknown): IUserAssets | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  if (record['quoteCurrency'] !== 'USD') {
    return null
  }

  const updatedAt = record['updatedAt']

  if (typeof updatedAt !== 'string' || updatedAt === '') {
    return null
  }

  const tokens = readTokenList(record['tokens'])

  if (tokens === null) {
    return null
  }

  return sanitizeAssets({
    quoteCurrency: 'USD',
    updatedAt,
    tokens,
  })
}

function readTokenList(value: unknown): readonly IAssetToken[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOKENS) {
    return null
  }

  const tokens: IAssetToken[] = []

  for (const item of value) {
    const token = readToken(item)

    if (token === null) {
      return null
    }

    tokens.push(token)
  }

  return tokens
}

function readToken(value: unknown): IAssetToken | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const chainId = record['chainId']
  const standard = record['standard']
  const symbol = record['symbol']
  const name = record['name']
  const decimals = record['decimals']
  const balance = record['balance']
  const isVerified = record['isVerified']

  if (typeof chainId !== 'string' || !INTEGER_STRING.test(chainId)) {
    return null
  }

  if (typeof standard !== 'string' || !FUNGIBLE_STANDARDS.has(standard)) {
    return null
  }

  const address = readTokenAddress(record['address'], standard)

  if (address === undefined) {
    return null
  }

  if (!isLabel(symbol, SYMBOL_MAX) || !isLabel(name, NAME_MAX)) {
    return null
  }

  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    return null
  }

  if (
    typeof balance !== 'string' ||
    !INTEGER_STRING.test(balance) ||
    typeof isVerified !== 'boolean'
  ) {
    return null
  }

  return {
    chainId,
    standard: standard as AssetStandard,
    address,
    symbol,
    name,
    decimals,
    balance,
    isVerified,
  }
}

function readTokenAddress(value: unknown, standard: string): string | null | undefined {
  if (standard === ASSET_STANDARD.Native) {
    return value === null ? null : undefined
  }

  if (typeof value !== 'string' || !hasAddressShape(value)) {
    return undefined
  }

  return toChecksumAddress(value)
}

function isLabel(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
