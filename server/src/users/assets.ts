import { hasAddressShape, toChecksumAddress } from '../lib/address.ts'

/**
 * Снимок активов в колонке `assets`.
 *
 * ЧИСЛА — СТРОКИ. `JSON.parse` теряет точность на wei и на курсах
 * с большим числом знаков. Оценка в долларах тоже строка: это величина
 * для показа, из неё не строится перевод.
 *
 * ЭТО НЕ БАЛАНС С УЗЛА. Колонка хранит витрину токенов. На создании
 * пользователя сервер кладёт сюда демонстрационный состав.
 */

export const ASSET_STANDARD = {
  Native: 'native',
  Erc20: 'ERC-20',
} as const

export type AssetStandard = (typeof ASSET_STANDARD)[keyof typeof ASSET_STANDARD]

const FUNGIBLE_STANDARDS = new Set<string>([ASSET_STANDARD.Native, ASSET_STANDARD.Erc20])

const DECIMAL_STRING = /^-?\d+(?:\.\d+)?$/u
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
  readonly priceUsd: string
  readonly valueUsd: string
  readonly change24hPercent: string
  readonly isVerified: boolean
}

/** Витрина портфеля пользователя. */
export interface IUserAssets {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly totalValueUsd: string
  readonly tokens: readonly IAssetToken[]
}

/** Пустая витрина: активов нет, это не «ноль на счёте». */
export function emptyAssets(): IUserAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: '1970-01-01T00:00:00.000Z',
    totalValueUsd: '0',
    tokens: [],
  }
}

/**
 * Разбирает колонку `assets`.
 *
 * Битая запись не роняет вход: отдаём пустую витрину, а не отказ.
 * Иначе один испорченный jsonb закрыл бы кабинет.
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
  const totalValueUsd = record['totalValueUsd']

  if (typeof updatedAt !== 'string' || updatedAt === '') {
    return null
  }

  if (typeof totalValueUsd !== 'string' || !DECIMAL_STRING.test(totalValueUsd)) {
    return null
  }

  const tokens = readTokenList(record['tokens'])

  if (tokens === null) {
    return null
  }

  return {
    quoteCurrency: 'USD',
    updatedAt,
    totalValueUsd,
    tokens,
  }
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
  const priceUsd = record['priceUsd']
  const valueUsd = record['valueUsd']
  const change24hPercent = record['change24hPercent']
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

  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return null
  }

  if (
    typeof balance !== 'string' ||
    !INTEGER_STRING.test(balance) ||
    typeof priceUsd !== 'string' ||
    !DECIMAL_STRING.test(priceUsd) ||
    typeof valueUsd !== 'string' ||
    !DECIMAL_STRING.test(valueUsd) ||
    typeof change24hPercent !== 'string' ||
    !DECIMAL_STRING.test(change24hPercent) ||
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
    priceUsd,
    valueUsd,
    change24hPercent,
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

/**
 * Витрина нового пользователя.
 *
 * Состав как у живого кошелька: ETH, стейблы, обёртки, те же адреса,
 * что в каталоге сервиса. Пишется при создании строки.
 */
export const MOCK_USER_ASSETS: IUserAssets = {
  quoteCurrency: 'USD',
  updatedAt: '2026-08-20T12:00:00.000Z',
  totalValueUsd: '14790.76',
  tokens: [
    {
      chainId: '1',
      standard: ASSET_STANDARD.Native,
      address: null,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      balance: '1284700000000000000',
      priceUsd: '3284.12',
      valueUsd: '4219.11',
      change24hPercent: '1.84',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: ASSET_STANDARD.Erc20,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: '2500000000',
      priceUsd: '1.0000',
      valueUsd: '2500.00',
      change24hPercent: '0.01',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: ASSET_STANDARD.Erc20,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      balance: '1800500000',
      priceUsd: '0.9998',
      valueUsd: '1800.14',
      change24hPercent: '-0.02',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: ASSET_STANDARD.Erc20,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      balance: '400000000000000000000',
      priceUsd: '1.0001',
      valueUsd: '400.04',
      change24hPercent: '0.00',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: ASSET_STANDARD.Erc20,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      balance: '4200000',
      priceUsd: '64120.00',
      valueUsd: '2693.04',
      change24hPercent: '0.62',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: ASSET_STANDARD.Erc20,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      balance: '750000000000000000',
      priceUsd: '3284.12',
      valueUsd: '2463.09',
      change24hPercent: '1.84',
      isVerified: true,
    },
    {
      chainId: '10',
      standard: ASSET_STANDARD.Erc20,
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: '320250000',
      priceUsd: '1.0000',
      valueUsd: '320.25',
      change24hPercent: '0.01',
      isVerified: true,
    },
    {
      chainId: '10',
      standard: ASSET_STANDARD.Erc20,
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      balance: '120000000000000000',
      priceUsd: '3284.12',
      valueUsd: '394.09',
      change24hPercent: '1.84',
      isVerified: true,
    },
  ],
}

export function mockUserAssets(): IUserAssets {
  return MOCK_USER_ASSETS
}
