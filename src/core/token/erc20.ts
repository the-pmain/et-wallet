import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type { Address, HexString } from '@/core/types'

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
  return bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)
}

/** Краткое имя для объявлений внутри этого модуля. */
const selector = functionSelector

/** `decimals()` — число десятичных знаков. */
export const DECIMALS_SELECTOR = selector('decimals()')

/** `symbol()` — краткое обозначение. */
export const SYMBOL_SELECTOR = selector('symbol()')

/** `name()` — полное имя. */
export const NAME_SELECTOR = selector('name()')

/** `balanceOf(address)` — баланс владельца. */
export const BALANCE_OF_SELECTOR = selector('balanceOf(address)')

/** Длина одного слова ABI в шестнадцатеричных символах. */
const WORD_LENGTH = 64

/** Вызов без аргументов. */
export function encodeCall(functionSelector: string): HexString {
  return `0x${functionSelector}` as HexString
}

/**
 * Вызов с одним адресом.
 *
 * Адрес занимает 20 байт, слово ABI — 32, поэтому значение дополняется
 * нулями слева. Регистр приводится к нижнему: контракт сравнивает байты,
 * и запись в контрольной сумме EIP-55 читалась бы как другое значение.
 */
export function encodeCallWithAddress(functionSelector: string, address: Address): HexString {
  return `0x${functionSelector}${address.slice(2).toLowerCase().padStart(WORD_LENGTH, '0')}` as HexString
}

/**
 * Читает беззнаковое целое из ответа контракта.
 *
 * @throws Error если ответ пуст: это означает, что функции нет.
 */
export function decodeUint(data: HexString): bigint {
  const body = strip(data)

  if (body === '') {
    throw new Error('контракт вернул пустой ответ')
  }

  return BigInt(`0x${body.slice(0, WORD_LENGTH)}`)
}

/**
 * Читает строку из ответа контракта.
 *
 * ПОДДЕРЖИВАЮТСЯ ДВА ВИДА ОТВЕТА, И ЭТО НЕ ИЗБЫТОЧНОСТЬ.
 *
 * Стандарт ERC-20 объявляет `symbol()` и `name()` возвращающими `string`,
 * то есть данные переменной длины: смещение, длина, содержимое. Но
 * значительная часть ранних токенов — MKR среди самых известных — была
 * выпущена до окончательной редакции стандарта и возвращает `bytes32`
 * с дополнением нулями справа.
 *
 * Декодер, понимающий только `string`, не добавит такие токены вовсе.
 * Различаются они по длине ответа: ровно одно слово означает `bytes32`,
 * два и более — строку переменной длины.
 *
 * @throws Error если ответ пуст либо не разбирается.
 */
export function decodeString(data: HexString): string {
  const body = strip(data)

  if (body === '') {
    throw new Error('контракт вернул пустой ответ')
  }

  /* Одно слово — это `bytes32`: значение лежит прямо в нём, дополненное
     нулями справа до конца. */
  if (body.length <= WORD_LENGTH) {
    return decodeBytes32(body)
  }

  return decodeDynamicString(body)
}

/**
 * Разбирает строку переменной длины в кодировке ABI.
 *
 * Первое слово — смещение до данных, второе по этому смещению — длина
 * в байтах, далее содержимое. Смещение читается, а не предполагается
 * равным 32: стандарт этого не гарантирует.
 */
function decodeDynamicString(body: string): string {
  const offset = Number(BigInt(`0x${body.slice(0, WORD_LENGTH)}`)) * 2
  const lengthStart = offset
  const lengthEnd = lengthStart + WORD_LENGTH

  if (lengthEnd > body.length) {
    throw new Error('ответ короче объявленного смещения')
  }

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthEnd)}`)) * 2
  const content = body.slice(lengthEnd, lengthEnd + length)

  return hexToUtf8(content)
}

/** Разбирает `bytes32`: содержимое до первого нулевого байта. */
function decodeBytes32(body: string): string {
  const padded = body.padEnd(WORD_LENGTH, '0')
  const nullIndex = padded.indexOf('00')

  /* Нулевой байт может оказаться на нечётной позиции внутри символа —
     тогда это часть значащего байта, а не признак конца. Поиск идёт
     по парам символов. */
  let end = padded.length

  for (let index = 0; index + 1 < padded.length; index += 2) {
    if (padded.slice(index, index + 2) === '00') {
      end = index
      break
    }
  }

  return hexToUtf8(padded.slice(0, nullIndex === -1 ? padded.length : end))
}

/**
 * Переводит шестнадцатеричные байты в текст.
 *
 * Кодировка UTF-8: символы вне латиницы в именах токенов встречаются,
 * а побайтовое преобразование исказило бы их.
 */
function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(Math.floor(hex.length / 2))

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return new TextDecoder().decode(bytes).replace(/\0+$/u, '')
}

function strip(data: HexString): string {
  return data.startsWith('0x') ? data.slice(2) : data
}
