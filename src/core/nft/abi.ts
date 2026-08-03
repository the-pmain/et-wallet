import { toAddress } from '@/core/address'
import { functionSelector } from '@/core/token'
import type { Address, HexString } from '@/core/types'

/**
 * Кодирование вызовов коллекционных контрактов.
 *
 * ПОЧЕМУ ПРИМИТИВЫ БЕРУТСЯ ИЗ МОДУЛЯ ТОКЕНОВ. `functionSelector`,
 * `decodeUint` и `decodeString` описывают кодировку ABI, а не стандарт
 * ERC-20: они одинаковы для любого контракта. Копия здесь означала бы
 * два места, где живёт одна и та же кодировка, и расхождение между ними
 * при первой же правке.
 *
 * ЗДЕСЬ ЛЕЖИТ ТОЛЬКО ТО, ЧЕГО В ТОМ МОДУЛЕ НЕТ: аргументы-числа
 * и вызовы с несколькими аргументами. У ERC-20 таких вызовов
 * не встречается.
 */

/** Длина одного слова ABI в шестнадцатеричных символах. */
const WORD_LENGTH = 64

/** Длина адреса в шестнадцатеричных символах: двадцать байт. */
const ADDRESS_LENGTH = 40

/** Наибольшее значение `uint256`. */
const MAX_UINT256 = (1n << 256n) - 1n

/** `ownerOf(uint256)` — владелец предмета ERC-721. */
export const OWNER_OF_SELECTOR = functionSelector('ownerOf(uint256)')

/** `tokenURI(uint256)` — ссылка на описание предмета ERC-721. */
export const TOKEN_URI_SELECTOR = functionSelector('tokenURI(uint256)')

/** `balanceOf(address,uint256)` — количество предметов ERC-1155 у владельца. */
export const ERC1155_BALANCE_OF_SELECTOR = functionSelector('balanceOf(address,uint256)')

/** `supportsInterface(bytes4)` — объявленная поддержка интерфейса (ERC-165). */
export const SUPPORTS_INTERFACE_SELECTOR = functionSelector('supportsInterface(bytes4)')

/** `safeTransferFrom(address,address,uint256)` — передача предмета ERC-721. */
export const SAFE_TRANSFER_721_SELECTOR = functionSelector(
  'safeTransferFrom(address,address,uint256)',
)

/** `safeTransferFrom(address,address,uint256,uint256,bytes)` — передача ERC-1155. */
export const SAFE_TRANSFER_1155_SELECTOR = functionSelector(
  'safeTransferFrom(address,address,uint256,uint256,bytes)',
)

/**
 * Кодирует одно беззнаковое число как слово ABI.
 *
 * @throws RangeError если значение отрицательно либо не помещается
 *         в `uint256`. Обрезать номер предмета молча нельзя: получился бы
 *         вызов про другой предмет.
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
 * Кодирует адрес как слово ABI.
 *
 * Регистр приводится к нижнему: контракт сравнивает байты, и запись
 * в контрольной сумме EIP-55 читалась бы как другое значение.
 */
export function encodeAddressWord(address: Address): string {
  return address.slice(2).toLowerCase().padStart(WORD_LENGTH, '0')
}

/** Вызов с одним числовым аргументом. */
export function encodeCallWithUint(selector: string, value: bigint): HexString {
  return `0x${selector}${encodeUintWord(value)}` as HexString
}

/** Вызов с адресом и числом — `balanceOf(address,uint256)` у ERC-1155. */
export function encodeCallWithAddressAndUint(
  selector: string,
  address: Address,
  value: bigint,
): HexString {
  return `0x${selector}${encodeAddressWord(address)}${encodeUintWord(value)}` as HexString
}

/**
 * Кодирует вызов `supportsInterface(bytes4)`.
 *
 * Аргумент `bytes4` выравнивается ВПРАВО от начала слова, в отличие
 * от чисел и адресов: короткие байтовые типы дополняются нулями справа.
 * Перепутанное выравнивание даёт вызов про другой интерфейс и молчаливое
 * «не поддерживается».
 */
export function encodeSupportsInterface(interfaceId: string): HexString {
  const id = interfaceId.startsWith('0x') ? interfaceId.slice(2) : interfaceId

  return `0x${SUPPORTS_INTERFACE_SELECTOR}${id.padEnd(WORD_LENGTH, '0')}` as HexString
}

/**
 * Кодирует передачу предмета ERC-721.
 *
 * ИСПОЛЬЗУЕТСЯ БЕЗОПАСНЫЙ ВАРИАНТ. Обычный `transferFrom` отправляет
 * предмет любому адресу, включая контракт, который не умеет их
 * принимать: предмет попадает туда навсегда. `safeTransferFrom`
 * спрашивает у контракта-получателя подтверждение и откатывается,
 * если его нет. Отправку обычному адресу это не усложняет.
 */
export function encodeSafeTransfer721(from: Address, to: Address, tokenId: bigint): HexString {
  return `0x${SAFE_TRANSFER_721_SELECTOR}${encodeAddressWord(from)}${encodeAddressWord(to)}${encodeUintWord(tokenId)}` as HexString
}

/**
 * Кодирует передачу предметов ERC-1155.
 *
 * ПОСЛЕДНИЙ АРГУМЕНТ — БАЙТЫ ПЕРЕМЕННОЙ ДЛИНЫ, и кодируются они иначе,
 * чем остальные: на его месте стоит смещение до данных, а сами данные
 * лежат в конце. Кошелёк передаёт пустую строку — дополнительных
 * сведений получателю он не сообщает.
 *
 * Смещение равно ста шестидесяти байтам: пять слов до него — отправитель,
 * получатель, номер, количество и само смещение.
 */
export function encodeSafeTransfer1155(
  from: Address,
  to: Address,
  tokenId: bigint,
  amount: bigint,
): HexString {
  const dataOffset = encodeUintWord(160n)
  const emptyData = encodeUintWord(0n)

  return `0x${SAFE_TRANSFER_1155_SELECTOR}${encodeAddressWord(from)}${encodeAddressWord(to)}${encodeUintWord(tokenId)}${encodeUintWord(amount)}${dataOffset}${emptyData}` as HexString
}

/**
 * Читает получателя из данных безопасной передачи.
 *
 * ЗАЧЕМ ЧИТАТЬ ТО, ЧТО САМИ СОБРАЛИ. Экран подтверждения обязан
 * показывать содержимое подписываемой транзакции, а не значения полей
 * формы: тогда совпадение показанного с подписываемым следует
 * из устройства экрана.
 *
 * Позиция получателя у обоих стандартов одна: второе слово после
 * селектора. Различаются они дальше — номером и количеством.
 *
 * @returns `null`, если данные не являются безопасной передачей.
 */
export function decodeSafeTransferRecipient(data: HexString): Address | null {
  const body = data.startsWith('0x') ? data.slice(2) : data
  const selector = body.slice(0, 8)

  if (selector !== SAFE_TRANSFER_721_SELECTOR && selector !== SAFE_TRANSFER_1155_SELECTOR) {
    return null
  }

  const word = body.slice(8 + WORD_LENGTH, 8 + WORD_LENGTH * 2)

  if (word.length !== WORD_LENGTH) {
    return null
  }

  if (word.slice(0, WORD_LENGTH - ADDRESS_LENGTH) !== '0'.repeat(WORD_LENGTH - ADDRESS_LENGTH)) {
    return null
  }

  return toAddress(`0x${word.slice(WORD_LENGTH - ADDRESS_LENGTH)}`)
}

/**
 * Читает адрес из ответа контракта.
 *
 * @throws Error если ответ пуст либо старшие байты слова ненулевые:
 *         слово, заполненное целиком, адресом не является, и выдавать
 *         его за адрес нельзя.
 */
export function decodeAddress(data: HexString): Address {
  const body = data.startsWith('0x') ? data.slice(2) : data

  if (body.length < WORD_LENGTH) {
    throw new Error('the contract returned a response shorter than one word')
  }

  const word = body.slice(0, WORD_LENGTH)
  const padding = word.slice(0, WORD_LENGTH - ADDRESS_LENGTH)

  if (padding !== '0'.repeat(WORD_LENGTH - ADDRESS_LENGTH)) {
    throw new Error('the response is not an address')
  }

  return toAddress(`0x${word.slice(WORD_LENGTH - ADDRESS_LENGTH)}`)
}

/**
 * Читает логическое значение из ответа контракта.
 *
 * Ненулевое слово означает `true`. Пустой ответ означает, что функции
 * нет: у ERC-165 это законный случай — старые контракты интерфейс
 * не объявляют.
 */
export function decodeBool(data: HexString): boolean {
  const body = data.startsWith('0x') ? data.slice(2) : data

  if (body === '') {
    return false
  }

  return BigInt(`0x${body.slice(0, WORD_LENGTH)}`) !== 0n
}
