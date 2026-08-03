import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { toAddress } from '@/core/address'
import type { Address, HexString } from '@/core/types'

/**
 * Кодировка ABI: то общее, что не относится ни к одному стандарту.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Длина слова, выравнивание адреса и разбор
 * ответа контракта одинаковы для ERC-20, ERC-721, ERC-1155 и любого
 * другого контракта: это правила кодирования, а не свойства стандарта.
 * Разложенные по модулям токенов, предметов и разрешений, они
 * существовали в трёх копиях — и копии уже начали расходиться.
 *
 * ЧЕМ ЭТО ОПАСНО ИМЕННО ЗДЕСЬ. Проверка «старшие двенадцать байт слова
 * нулевые» стояла в двух местах и определяла, какой адрес показать
 * на экране подтверждения. Расхождение копий означало бы, что в одном
 * месте кошелёк отвергает подделанное слово, а в другом принимает
 * и показывает владельцу чужой адрес как получателя.
 *
 * ЧТО СЮДА НЕ ВХОДИТ. Селекторы конкретных функций и разбор конкретных
 * вызовов: они принадлежат стандартам и живут в своих модулях.
 */

/** Длина слова ABI в шестнадцатеричных символах: тридцать два байта. */
export const WORD_LENGTH = 64

/** Длина селектора функции в шестнадцатеричных символах: четыре байта. */
export const SELECTOR_LENGTH = 8

/** Длина адреса в шестнадцатеричных символах: двадцать байт. */
export const ADDRESS_LENGTH = 40

/** Наибольшее значение `uint256`. */
export const MAX_UINT256 = (1n << 256n) - 1n

/** Отступ адреса внутри слова: старшие байты, которые обязаны быть нулевыми. */
const ADDRESS_PADDING = WORD_LENGTH - ADDRESS_LENGTH

/**
 * Селектор функции — первые четыре байта keccak256 от её подписи.
 *
 * ЗНАЧЕНИЯ ВЫЧИСЛЯЮТСЯ, А НЕ ВПИСЫВАЮТСЯ КОНСТАНТАМИ. Восемь
 * шестнадцатеричных символов, скопированных из памяти, непроверяемы
 * при чтении кода: ошибка в одном из них даёт вызов несуществующей
 * функции и отказ контракта без внятной причины. Подпись читается
 * и сверяется со стандартом глазами.
 */
export function functionSelector(signature: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, SELECTOR_LENGTH)
}

/**
 * Идентификатор события в журнале — keccak256 от подписи целиком.
 *
 * От селектора функции отличается длиной: событие занимает все
 * тридцать два байта, функция — первые четыре. Перепутать их значит
 * искать в журналах то, чего там нет, и получать пустой список без
 * единого сообщения об ошибке.
 */
export function eventTopic(signature: string): HexString {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(signature)))}` as HexString
}

/** Убирает префикс `0x`, если он есть. */
export function strip(data: HexString | string): string {
  return data.startsWith('0x') ? data.slice(2) : data
}

/**
 * Кодирует беззнаковое число как слово.
 *
 * @throws RangeError если значение отрицательно либо не помещается
 *         в `uint256`. Обрезать величину молча нельзя: получился бы
 *         вызов с другой суммой или про другой предмет.
 */
export function encodeUintWord(value: bigint): string {
  if (value < 0n) {
    throw new RangeError('The value cannot be negative.')
  }

  if (value > MAX_UINT256) {
    throw new RangeError('The value does not fit into uint256.')
  }

  return value.toString(16).padStart(WORD_LENGTH, '0')
}

/**
 * Кодирует адрес как слово.
 *
 * Регистр приводится к нижнему: контракт сравнивает байты, и запись
 * с контрольной суммой EIP-55 читалась бы как другое значение.
 */
export function encodeAddressWord(address: Address): string {
  return address.slice(2).toLowerCase().padStart(WORD_LENGTH, '0')
}

/** Вызов без аргументов. */
export function encodeCall(selector: string): HexString {
  return `0x${selector}` as HexString
}

/** Вызов с одним адресом. */
export function encodeCallWithAddress(selector: string, address: Address): HexString {
  return `0x${selector}${encodeAddressWord(address)}` as HexString
}

/** Вызов с одним числом. */
export function encodeCallWithUint(selector: string, value: bigint): HexString {
  return `0x${selector}${encodeUintWord(value)}` as HexString
}

/** Вызов с адресом и числом. */
export function encodeCallWithAddressAndUint(
  selector: string,
  address: Address,
  value: bigint,
): HexString {
  return `0x${selector}${encodeAddressWord(address)}${encodeUintWord(value)}` as HexString
}

/** Вызов с двумя адресами. */
export function encodeCallWithTwoAddresses(
  selector: string,
  first: Address,
  second: Address,
): HexString {
  return `0x${selector}${encodeAddressWord(first)}${encodeAddressWord(second)}` as HexString
}

/**
 * Читает адрес из слова, проверяя выравнивание.
 *
 * ЭТО ПРОВЕРКА БЕЗОПАСНОСТИ, А НЕ ФОРМАЛЬНОСТЬ. Адрес занимает младшие
 * двадцать байт; слово с ненулевыми старшими байтами адресом
 * не является. Прочитав его как адрес, кошелёк показал бы на экране
 * подтверждения получателя, которого в вызове нет.
 *
 * @returns `null`, если слово адресом не является.
 */
export function readAddressWord(word: string): Address | null {
  if (word.length !== WORD_LENGTH) {
    return null
  }

  if (word.slice(0, ADDRESS_PADDING) !== '0'.repeat(ADDRESS_PADDING)) {
    return null
  }

  return toAddress(`0x${word.slice(ADDRESS_PADDING)}`)
}

/**
 * Читает беззнаковое целое из ответа контракта.
 *
 * @throws Error если ответ пуст: это означает, что функции нет.
 */
export function decodeUint(data: HexString): bigint {
  const body = strip(data)

  if (body === '') {
    throw new Error('the contract returned an empty response')
  }

  return BigInt(`0x${body.slice(0, WORD_LENGTH)}`)
}

/**
 * Читает логическое значение из ответа контракта.
 *
 * Ненулевое слово означает `true`. Пустой ответ означает, что функции
 * нет: у ERC-165 это законный случай — старые контракты интерфейс
 * не объявляют.
 */
export function decodeBool(data: HexString): boolean {
  const body = strip(data)

  return body === '' ? false : BigInt(`0x${body.slice(0, WORD_LENGTH)}`) !== 0n
}

/**
 * Читает адрес из ответа контракта.
 *
 * @throws Error если ответ короче слова либо слово адресом не является.
 */
export function decodeAddress(data: HexString): Address {
  const body = strip(data)

  if (body.length < WORD_LENGTH) {
    throw new Error('the contract returned a response shorter than one word')
  }

  const address = readAddressWord(body.slice(0, WORD_LENGTH))

  if (address === null) {
    throw new Error('the response is not an address')
  }

  return address
}
