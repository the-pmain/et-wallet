import {
  SELECTOR_LENGTH,
  WORD_LENGTH,
  encodeAddressWord,
  encodeUintWord,
  functionSelector,
  readAddressWord,
  strip,
} from '@/core/abi'
import type { Address, HexString } from '@/core/types'

/**
 * Кодирование вызовов ERC-20.
 *
 * ЗДЕСЬ ТОЛЬКО ЗНАНИЕ СТАНДАРТА: селекторы функций и разбор их
 * аргументов. Правила кодирования — длина слова, выравнивание адреса,
 * чтение чисел и строк — живут в `core/abi` и общие для всех
 * контрактов.
 */

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

/** `transfer(address,uint256)` — перевод токена. */
export const TRANSFER_SELECTOR = selector('transfer(address,uint256)')

/**
 * Кодирует вызов `transfer(address,uint256)`.
 *
 * ЭТО МЕСТО, ГДЕ ОШИБКА СТОИТ СРЕДСТВ. Данные вызова — единственное,
 * что определяет получателя и сумму перевода токена: поле `to` самой
 * транзакции указывает на контракт, а не на человека. Ошибка
 * в кодировании отправит токены не туда, и вернуть их будет нельзя.
 *
 * КОДИРОВАНИЕ ВЫПОЛНЯЕТСЯ В ЯДРЕ, А НЕ В ИНТЕРФЕЙСЕ. Экран отправки
 * оперирует получателем и суммой; собирать из них байты вызова —
 * работа слоя, который знает стандарт.
 *
 * @throws RangeError если сумма отрицательна либо не помещается
 *         в `uint256`: молча обрезанное значение отправило бы совсем
 *         не ту сумму, которую подтвердил пользователь.
 */
export function encodeTransfer(to: Address, amount: bigint): HexString {
  return `0x${TRANSFER_SELECTOR}${encodeAddressWord(to)}${encodeUintWord(amount)}` as HexString
}

/**
 * Разбирает вызов `transfer(address,uint256)`.
 *
 * ЗАЧЕМ ЧИТАТЬ ТО, ЧТО САМИ СОБРАЛИ. Запись истории строится из данных
 * подписанной транзакции, а не из намерения, которое было до подписи.
 * Так в историю попадает ровно то, что ушло в сеть: если между формой
 * и подписью что-то разошлось, запись покажет действительное содержимое,
 * а не желаемое.
 *
 * @returns `null`, если данные не являются вызовом `transfer` нужной
 *          длины. Ошибка здесь неуместна: перевод токена — лишь один
 *          из возможных вызовов.
 */
export function decodeTransfer(
  data: HexString,
): { readonly to: Address; readonly amount: bigint } | null {
  const body = strip(data)

  /* Селектор занимает четыре байта, аргументы — два слова. Более
     длинные данные означают другой вызов с тем же началом. */
  if (body.length !== SELECTOR_LENGTH + WORD_LENGTH * 2) {
    return null
  }

  if (body.slice(0, SELECTOR_LENGTH) !== TRANSFER_SELECTOR) {
    return null
  }

  /* Слово с ненулевыми старшими байтами адресом не является: выдать
     его за получателя значило бы показать на экране подтверждения
     того, кого в вызове нет. */
  const to = readAddressWord(body.slice(SELECTOR_LENGTH, SELECTOR_LENGTH + WORD_LENGTH))

  if (to === null) {
    return null
  }

  return { to, amount: BigInt(`0x${body.slice(SELECTOR_LENGTH + WORD_LENGTH)}`) }
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
    throw new Error('the contract returned an empty response')
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
    throw new Error('the response is shorter than the declared offset')
  }

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthEnd)}`)) * 2
  const content = body.slice(lengthEnd, lengthEnd + length)

  return hexToUtf8(content)
}

/** Разбирает `bytes32`: содержимое до первого нулевого байта. */
function decodeBytes32(body: string): string {
  const padded = body.padEnd(WORD_LENGTH, '0')

  /* Нулевой байт может оказаться на нечётной позиции внутри символа —
     тогда это часть значащего байта, а не признак конца. Поиск идёт
     по парам символов. */
  let end = padded.length

  for (let index = 0; index < padded.length; index += 2) {
    if (padded.slice(index, index + 2) === '00') {
      end = index
      break
    }
  }

  return hexToUtf8(padded.slice(0, end))
}

/** Переводит шестнадцатеричную строку в текст. */
function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return new TextDecoder().decode(bytes)
}
