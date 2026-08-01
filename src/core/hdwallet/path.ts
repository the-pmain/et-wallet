import { InvalidDerivationPathError } from '@/core/errors'
import type { DerivationPath } from '@/core/types'

/**
 * Смещение закалённой (hardened) деривации из BIP-32.
 *
 * Индексы от 0 до 2^31-1 — обычная деривация, от 2^31 до 2^32-1 — закалённая.
 * Поэтому пользовательский индекс обязан быть строго меньше 2^31.
 */
export const HARDENED_OFFSET = 0x80000000

/** Назначение по BIP-44. Значение 44 закреплено стандартом. */
export const BIP44_PURPOSE = 44

/**
 * Тип монеты для Ethereum по SLIP-44.
 *
 * Все EVM-совместимые сети используют 60, а не собственные номера.
 * Это соглашение отрасли, а не требование стандарта: BNB Chain, Polygon,
 * Arbitrum и прочие деривируют ключи по тому же пути, что Ethereum,
 * поэтому один аккаунт имеет один адрес во всех сетях.
 *
 * Исключение — Ethereum Classic (61) и несколько форков, которые
 * зарегистрировали свои номера. Их поддержка потребует другого coinType.
 */
export const EVM_COIN_TYPE = 60

/** Внешняя цепочка BIP-44: адреса, которые сообщаются другим. */
export const CHANGE_EXTERNAL = 0

/**
 * Внутренняя цепочка BIP-44: адреса сдачи.
 *
 * В EVM-сетях не используется — модель UTXO с её сдачей там отсутствует.
 * Константа объявлена для полноты и для разбора путей, пришедших
 * из кошельков других экосистем.
 */
export const CHANGE_INTERNAL = 1

/** Общий формат пути BIP-32: `m` и далее индексы, возможно закалённые. */
const PATH_PATTERN = /^m(\/\d+'?)*$/

/** Параметры, задающие ветвь дерева выше индекса адреса. */
export interface IDerivationPathOptions {
  readonly purpose?: number
  readonly coinType?: number

  /**
   * Индекс аккаунта BIP-44 — третий уровень пути, закалённый.
   *
   * ВАЖНО ПРО СОВМЕСТИМОСТЬ. Существуют два несовместимых соглашения:
   *
   * - `m/44'/60'/0'/0/n` — наращивается индекс АДРЕСА. Так делают
   *   MetaMask, Rabby, Trust Wallet. Это соглашение по умолчанию здесь.
   * - `m/44'/60'/n'/0/0` — наращивается индекс АККАУНТА. Так делает
   *   Ledger Live.
   *
   * Кошелёк, поддерживающий только первое, при импорте фразы из Ledger Live
   * покажет пустой баланс: адреса будут выведены по другой ветви дерева.
   * Поэтому индекс аккаунта вынесен в параметр, а не зашит константой.
   */
  readonly accountIndex?: number

  readonly change?: number
}

/** Разобранный путь BIP-44. */
export interface IParsedBip44Path {
  readonly purpose: number
  readonly coinType: number
  readonly accountIndex: number
  readonly change: number
  readonly addressIndex: number
}

/**
 * Создаёт значение типа `DerivationPath` с проверкой формата.
 *
 * Единственный допустимый способ получить это значение. Приведение типом
 * обходит проверку: путь с индексом вне диапазона приведёт к выводу ключа
 * из другой ветви дерева, то есть к «потере» средств на адресе, который
 * кошелёк больше не покажет.
 *
 * @throws InvalidDerivationPathError
 */
export function toDerivationPath(value: string): DerivationPath {
  if (!PATH_PATTERN.test(value)) {
    throw new InvalidDerivationPathError(value, "ожидается формат вида m/44'/60'/0'/0/0")
  }

  const segments = value.split('/').slice(1)

  for (const segment of segments) {
    const index = Number.parseInt(segment.replace("'", ''), 10)

    if (!Number.isSafeInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new InvalidDerivationPathError(
        value,
        `индекс "${segment}" вне диапазона 0..${String(HARDENED_OFFSET - 1)}`,
      )
    }
  }

  return value as DerivationPath
}

/** Проверяет, что индекс пригоден для несмягчённой деривации. */
export function assertValidIndex(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= HARDENED_OFFSET) {
    throw new InvalidDerivationPathError(
      String(value),
      `${name} должен быть целым числом от 0 до ${String(HARDENED_OFFSET - 1)}`,
    )
  }
}

/**
 * Путь уровня аккаунта: `m/44'/60'/0'`.
 *
 * Именно на этом уровне имеет смысл экспортировать расширенные ключи:
 * все три индекса выше закалённые, поэтому xpub этого уровня раскрывает
 * только один аккаунт, а не всё дерево.
 */
export function buildAccountPath(options: IDerivationPathOptions = {}): DerivationPath {
  const purpose = options.purpose ?? BIP44_PURPOSE
  const coinType = options.coinType ?? EVM_COIN_TYPE
  const accountIndex = options.accountIndex ?? 0

  assertValidIndex(purpose, 'purpose')
  assertValidIndex(coinType, 'coinType')
  assertValidIndex(accountIndex, 'accountIndex')

  return `m/${String(purpose)}'/${String(coinType)}'/${String(accountIndex)}'` as DerivationPath
}

/** Путь уровня цепочки: `m/44'/60'/0'/0`. */
export function buildChangePath(options: IDerivationPathOptions = {}): DerivationPath {
  const change = options.change ?? CHANGE_EXTERNAL

  assertValidIndex(change, 'change')

  return `${buildAccountPath(options)}/${String(change)}` as DerivationPath
}

/** Полный путь адреса: `m/44'/60'/0'/0/n`. */
export function buildAddressPath(
  addressIndex: number,
  options: IDerivationPathOptions = {},
): DerivationPath {
  assertValidIndex(addressIndex, 'addressIndex')

  return `${buildChangePath(options)}/${String(addressIndex)}` as DerivationPath
}

/**
 * Разбирает полный путь BIP-44 на составляющие.
 *
 * Нужен при импорте аккаунта, выведенного другим кошельком: по пути видно,
 * какое соглашение применялось и какой индекс наращивался.
 *
 * @throws InvalidDerivationPathError если путь не пятиуровневый либо
 *         первые три уровня не закалённые.
 */
export function parseBip44Path(value: string): IParsedBip44Path {
  const path = toDerivationPath(value)
  const segments = path.split('/').slice(1)

  if (segments.length !== 5) {
    throw new InvalidDerivationPathError(
      value,
      `путь BIP-44 состоит из пяти уровней, получено ${String(segments.length)}`,
    )
  }

  const [purpose, coinType, accountIndex, change, addressIndex] = segments as [
    string,
    string,
    string,
    string,
    string,
  ]

  for (const segment of [purpose, coinType, accountIndex]) {
    if (!segment.endsWith("'")) {
      throw new InvalidDerivationPathError(
        value,
        'первые три уровня BIP-44 обязаны быть закалёнными',
      )
    }
  }

  for (const segment of [change, addressIndex]) {
    if (segment.endsWith("'")) {
      throw new InvalidDerivationPathError(
        value,
        'уровни change и addressIndex не могут быть закалёнными',
      )
    }
  }

  return {
    purpose: Number.parseInt(purpose, 10),
    coinType: Number.parseInt(coinType, 10),
    accountIndex: Number.parseInt(accountIndex, 10),
    change: Number.parseInt(change, 10),
    addressIndex: Number.parseInt(addressIndex, 10),
  }
}
