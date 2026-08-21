import { hasAddressShape, toChecksumAddress } from '../lib/address.ts'

/**
 * Снимок активов в колонке `assets`.
 *
 * ЧИСЛА — СТРОКИ. `JSON.parse` теряет точность на wei.
 *
 * ЗДЕСЬ ТОЛЬКО ОСТАТКИ. Курс и оценка в долларах считаются на клиенте
 * по живому источнику; в записи их нет, чтобы устаревшая сумма
 * не выдавалась за текущую.
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

/** Взаимозаменяемая позиция: нативная валюта или ERC-20. */
export interface IAssetToken {
  readonly chainId: string
  readonly standard: AssetStandard
  /** Адрес контракта. `null` у нативной валюты. */
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  /** Остаток в минимальных единицах. */
  readonly balance: string
  readonly isVerified: boolean
}

/** Витрина портфеля пользователя. */
export interface IUserAssets {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly tokens: readonly IAssetToken[]
}

/** Пустая витрина: активов нет, это не «ноль на счёте». */
export function emptyAssets(): IUserAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: '1970-01-01T00:00:00.000Z',
    tokens: [],
  }
}

/**
 * Стартовая витрина нового пользователя.
 *
 * Одна позиция: нативный ETH в Ethereum, остаток `"0"`.
 * Остальные монеты в запись не кладутся — их добавляют позже.
 * Курса, оценки и суточной динамики в записи нет.
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
 * Оставляет в витрине только хранимые поля.
 *
 * `priceUsd`, `valueUsd`, `totalValueUsd`, `change24hPercent` отбрасываются.
 */
export function sanitizeAssets(assets: IUserAssets): IUserAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: assets.updatedAt,
    tokens: assets.tokens.map(sanitizeToken),
  }
}

/** Остаток каждой позиции — `"0"`, даже если в запросе пришло другое. */
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
 * Разбирает колонку `assets`.
 *
 * Битая запись не роняет вход: отдаём пустую витрину, а не отказ.
 * Иначе один испорченный jsonb закрыл бы кабинет.
 *
 * Поля `totalValueUsd`, `priceUsd`, `valueUsd` в старых строках
 * игнорируются: оценка больше не хранится.
 */
export function parseAssets(value: unknown): IUserAssets {
  const parsed = readAssets(value)

  return parsed ?? emptyAssets()
}

/**
 * Разбирает `assets` из тела запроса.
 *
 * Отсутствующее поле — `null`: вызывающий подставляет витрину по умолчанию.
 * Пришедший объект обязан быть пригоден целиком.
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
