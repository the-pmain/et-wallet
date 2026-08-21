import { hasAddressShape, toChecksumAddress } from '../lib/address.ts'

/** Одна запись в колонке `wallets`: адрес и строковое значение. */
export interface IWalletEntry {
  readonly key: string
  readonly value: string
}

/** Список кошельков пользователя. Пустой список — ещё ни одного адреса. */
export type IUserWallets = readonly IWalletEntry[]

/** Длина `value`. Имя аккаунта в клиенте не длиннее 64. */
export const WALLET_VALUE_MAX_LENGTH = 64

const WALLET_ENTRY_KEY = 'key'
const WALLET_ENTRY_VALUE = 'value'

/** Пустой список. */
export function emptyWallets(): IUserWallets {
  return []
}

/**
 * Разбирает колонку `wallets`.
 *
 * Принимает список `{ key, value }`, одиночный объект той же формы
 * и прежнюю карту `{ "0x…": "…" }`, чтобы старые строки не потерялись.
 * Битые элементы отбрасываются: jsonb принимает что угодно, а наружу
 * уходит только список адресов.
 */
export function parseWallets(value: unknown): IUserWallets {
  if (value === null || value === undefined) {
    return emptyWallets()
  }

  if (Array.isArray(value)) {
    let wallets = emptyWallets()

    for (const item of value) {
      const entry = readWalletEntry(item)

      if (entry !== null) {
        wallets = mergeWallet(wallets, entry.key, entry.value)
      }
    }

    return wallets
  }

  if (typeof value !== 'object') {
    return emptyWallets()
  }

  const single = readWalletEntry(value)

  if (single !== null) {
    return [single]
  }

  return readLegacyMap(value)
}

/**
 * Добавляет или заменяет адрес. Совпадение без учёта регистра
 * не плодит две записи одного кошелька.
 */
export function mergeWallet(wallets: IUserWallets, key: string, value: string): IUserWallets {
  const checksum = toChecksumAddress(key)
  const next: IWalletEntry[] = []

  for (const entry of wallets) {
    if (entry.key.toLowerCase() !== checksum.toLowerCase()) {
      next.push(entry)
    }
  }

  next.push({ key: checksum, value })

  return next
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

/**
 * Разбирает `wallets` из тела запроса.
 *
 * Отсутствующее поле — пустой список. Одиночный `{ key, value }`
 * или массив таких объектов. Битая запись — отказ целиком:
 * на создании нельзя молча отбросить адрес.
 */
export function readWalletsPayload(value: unknown): IUserWallets | null {
  if (value === undefined) {
    return emptyWallets()
  }

  if (value === null || typeof value !== 'object') {
    return null
  }

  if (Array.isArray(value)) {
    return readEntryList(value)
  }

  const single = readWalletEntry(value)

  return single === null ? null : [single]
}

function readWalletEntry(value: unknown): IWalletEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const key = record[WALLET_ENTRY_KEY]
  const rawValue = record[WALLET_ENTRY_VALUE]

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

  return { key: toChecksumAddress(key), value: parsedValue }
}

function readEntryList(value: readonly unknown[]): IUserWallets | null {
  let wallets = emptyWallets()

  for (const item of value) {
    const entry = readWalletEntry(item)

    if (entry === null) {
      return null
    }

    wallets = mergeWallet(wallets, entry.key, entry.value)
  }

  return wallets
}

/** Прежняя карта `{ "0x…": "подпись" }` — читаем, больше не пишем. */
function readLegacyMap(value: object): IUserWallets {
  let wallets = emptyWallets()

  for (const [key, entry] of Object.entries(value)) {
    if (!hasAddressShape(key) || typeof entry !== 'string') {
      continue
    }

    const parsedValue = readWalletValue(entry)

    if (parsedValue === null) {
      continue
    }

    wallets = mergeWallet(wallets, key, parsedValue)
  }

  return wallets
}
