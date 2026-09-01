import { hasAddressShape, toChecksumAddress } from '../lib/address.ts'

/** Назначение основного адреса для входящих переводов. */
export const WALLET_CODENAME_RECEIVING_FUNDS = 'address-receiving-funds'

/** Адрес для входящих переводов с биржи или учреждения. */
export const WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE = 'address-receiving-funds-exchange'

/** Одна запись кошелька: адрес и строковое значение. */
export interface IWalletSlot {
  readonly key: string
  readonly value: string
}

/** Карта кошельков по `codename`. */
export type IUserWallets = Readonly<Record<string, IWalletSlot>>

/** Запись из HTTP-тела, где `codename` может идти отдельным полем. */
export interface IWalletEntryInput {
  readonly key: string
  readonly value: string
  readonly codename?: string
}

/** Начальное `value` созданного адреса. Не секрет. */
export const INITIAL_WALLET_VALUE = '0'

/** Длина `value`. Имя аккаунта в клиенте не длиннее 64. */
export const WALLET_VALUE_MAX_LENGTH = 64

/** Длина `codename`. Короткий идентификатор назначения кошелька. */
export const WALLET_CODENAME_MAX_LENGTH = 64

const WALLET_ENTRY_KEY = 'key'
const WALLET_ENTRY_VALUE = 'value'
const WALLET_ENTRY_CODENAME = 'codename'

/** Пустая карта. */
export function emptyWallets(): IUserWallets {
  return {}
}

/** Все адреса с нулевым значением: так создаётся кошелёк. */
export function withZeroBalances(wallets: IUserWallets): IUserWallets {
  const next: Record<string, IWalletSlot> = {}

  for (const [codename, slot] of Object.entries(wallets)) {
    next[codename] = { key: slot.key, value: INITIAL_WALLET_VALUE }
  }

  return next
}

/**
 * Разбирает колонку `wallets`.
 *
 * Принимает карту `{ codename: { key, value } }`, список `{ key, value, codename? }`,
 * одиночный объект той же формы и прежнюю карту `{ "0x…": "…" }`.
 */
export function parseWallets(value: unknown): IUserWallets {
  if (value === null || value === undefined) {
    return emptyWallets()
  }

  if (Array.isArray(value)) {
    return readEntryList(value)
  }

  if (typeof value !== 'object') {
    return emptyWallets()
  }

  const record = value as Record<string, unknown>
  const single = readWalletEntry(value)

  if (single !== null) {
    return { [single.codename]: { key: single.key, value: single.value } }
  }

  if (isCodenameMap(record)) {
    return readCodenameMap(record)
  }

  return readLegacyMap(value)
}

/** Добавляет или заменяет слот по `codename`. */
export function mergeWallet(
  wallets: IUserWallets,
  codename: string,
  key: string,
  value: string,
): IUserWallets {
  const parsedCodename = readWalletCodename(codename)

  if (parsedCodename === null) {
    throw new Error(`Codename кошелька непригоден: ${codename}`)
  }

  return {
    ...wallets,
    [parsedCodename]: {
      key: toChecksumAddress(key),
      value,
    },
  }
}

/** Возвращает слот по `codename`. */
export function findWalletSlot(wallets: IUserWallets, codename: string): IWalletSlot | null {
  return wallets[codename] ?? null
}

/** Принимает ли строка вид ключа карты. */
export function isWalletKey(value: string): boolean {
  return hasAddressShape(value)
}

/** `value` после обрезки, либо `null` если пустая или слишком длинная. */
export function readWalletValue(value: string): string | null {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed.length > WALLET_VALUE_MAX_LENGTH) {
    return null
  }

  return trimmed
}

/** `codename` после обрезки, либо `null` если пустой или слишком длинный. */
export function readWalletCodename(value: string): string | null {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed.length > WALLET_CODENAME_MAX_LENGTH) {
    return null
  }

  if (!/^[a-z0-9-]+$/u.test(trimmed)) {
    return null
  }

  return trimmed
}

/**
 * Разбирает `wallets` из тела запроса.
 *
 * Отсутствующее поле — пустая карта. Карта, список или одиночный объект.
 * Битая запись — отказ целиком.
 */
export function readWalletsPayload(value: unknown): IUserWallets | null {
  if (value === undefined) {
    return emptyWallets()
  }

  if (value === null || typeof value !== 'object') {
    return null
  }

  if (Array.isArray(value)) {
    return readEntryListStrict(value)
  }

  const single = readWalletEntry(value)

  if (single !== null) {
    return { [single.codename]: { key: single.key, value: single.value } }
  }

  if (isCodenameMap(value as Record<string, unknown>)) {
    return readCodenameMapStrict(value as Record<string, unknown>)
  }

  return null
}

function readWalletEntry(value: unknown): { readonly codename: string; readonly key: string; readonly value: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const key = record[WALLET_ENTRY_KEY]
  const rawValue = record[WALLET_ENTRY_VALUE]
  const rawCodename = record[WALLET_ENTRY_CODENAME]

  if (typeof key !== 'string' || typeof rawValue !== 'string') {
    return null
  }

  if (!isWalletKey(key)) {
    return null
  }

  const parsedValue = readWalletValue(rawValue)

  if (parsedValue === null) {
    return null
  }

  const codename =
    rawCodename === undefined
      ? fallbackCodenameForAddress(key, 0)
      : readWalletCodename(typeof rawCodename === 'string' ? rawCodename : '')

  if (codename === null) {
    return null
  }

  return {
    codename,
    key: toChecksumAddress(key),
    value: parsedValue,
  }
}

function readEntryList(value: readonly unknown[]): IUserWallets {
  let wallets = emptyWallets()

  for (const [index, item] of value.entries()) {
    const entry = readWalletEntry(item)

    if (entry === null) {
      continue
    }

    const codename =
      entry.codename === fallbackCodenameForAddress(entry.key, index)
        ? resolveLegacyCodename(wallets, entry.key, index)
        : entry.codename

    wallets = mergeWallet(wallets, codename, entry.key, entry.value)
  }

  return wallets
}

function readEntryListStrict(value: readonly unknown[]): IUserWallets | null {
  let wallets = emptyWallets()

  for (const [index, item] of value.entries()) {
    const entry = readWalletEntry(item)

    if (entry === null) {
      return null
    }

    const codename =
      entry.codename === fallbackCodenameForAddress(entry.key, index)
        ? resolveLegacyCodename(wallets, entry.key, index)
        : entry.codename

    wallets = mergeWallet(wallets, codename, entry.key, entry.value)
  }

  return wallets
}

function isCodenameMap(value: Record<string, unknown>): boolean {
  for (const slot of Object.values(value)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      return false
    }

    const record = slot as Record<string, unknown>

    if (typeof record[WALLET_ENTRY_KEY] !== 'string' || typeof record[WALLET_ENTRY_VALUE] !== 'string') {
      return false
    }
  }

  return Object.keys(value).length > 0
}

function readCodenameMap(value: Record<string, unknown>): IUserWallets {
  let wallets = emptyWallets()

  for (const [rawCodename, slot] of Object.entries(value)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      continue
    }

    const record = slot as Record<string, unknown>
    const key = record[WALLET_ENTRY_KEY]
    const rawValue = record[WALLET_ENTRY_VALUE]

    if (typeof key !== 'string' || typeof rawValue !== 'string') {
      continue
    }

    const parsedCodename = readWalletCodename(rawCodename)
    const parsedValue = readWalletValue(rawValue)

    if (parsedCodename === null || parsedValue === null || !isWalletKey(key)) {
      continue
    }

    wallets = mergeWallet(wallets, parsedCodename, key, parsedValue)
  }

  return wallets
}

function readCodenameMapStrict(value: Record<string, unknown>): IUserWallets | null {
  let wallets = emptyWallets()

  for (const [rawCodename, slot] of Object.entries(value)) {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      return null
    }

    const record = slot as Record<string, unknown>
    const key = record[WALLET_ENTRY_KEY]
    const rawValue = record[WALLET_ENTRY_VALUE]

    if (typeof key !== 'string' || typeof rawValue !== 'string') {
      return null
    }

    const parsedCodename = readWalletCodename(rawCodename)
    const parsedValue = readWalletValue(rawValue)

    if (parsedCodename === null || parsedValue === null || !isWalletKey(key)) {
      return null
    }

    wallets = mergeWallet(wallets, parsedCodename, key, parsedValue)
  }

  return wallets
}

/** Прежняя карта `{ "0x…": "подпись" }` — читаем, больше не пишем. */
function readLegacyMap(value: object): IUserWallets {
  let wallets = emptyWallets()
  let index = 0

  for (const [key, entry] of Object.entries(value)) {
    if (!hasAddressShape(key) || typeof entry !== 'string') {
      continue
    }

    const parsedValue = readWalletValue(entry)

    if (parsedValue === null) {
      continue
    }

    const codename = resolveLegacyCodename(wallets, key, index)

    wallets = mergeWallet(wallets, codename, key, parsedValue)
    index += 1
  }

  return wallets
}

function resolveLegacyCodename(wallets: IUserWallets, key: string, index: number): string {
  if (index === 0 && wallets[WALLET_CODENAME_RECEIVING_FUNDS] === undefined) {
    return WALLET_CODENAME_RECEIVING_FUNDS
  }

  return fallbackCodenameForAddress(key, index)
}

function fallbackCodenameForAddress(key: string, index: number): string {
  if (index === 0) {
    return WALLET_CODENAME_RECEIVING_FUNDS
  }

  return `wallet-${toChecksumAddress(key).toLowerCase()}`
}
