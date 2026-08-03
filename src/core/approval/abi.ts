import {
  encodeAddressWord,
  encodeCallWithTwoAddresses,
  encodeUintWord,
  eventTopic,
  functionSelector,
} from '@/core/abi'
import type { Address, HexString } from '@/core/types'

/**
 * Кодировка вызовов и событий, относящихся к разрешениям.
 *
 * ЗНАЧЕНИЯ ВЫЧИСЛЯЮТСЯ ИЗ ПОДПИСЕЙ, а не вписываются константами.
 * Хэш события, скопированный из памяти, непроверяем при чтении кода:
 * ошибка в одном символе даёт пустой список разрешений без единого
 * сообщения об ошибке — то есть кошелёк молча сообщит владельцу,
 * что он никому ничего не разрешал.
 */

/**
 * `Approval(address,address,uint256)` — выдача разрешения ERC-20.
 *
 * Владелец и получатель разрешения индексированы, сумма лежит в данных.
 * ERC-721 использует событие с тем же именем, но у него индексирован
 * ещё и номер предмета — четыре темы вместо трёх. Разрешение на один
 * предмет здесь не рассматривается: оно исчезает при первой же передаче.
 */
export const APPROVAL_TOPIC = eventTopic('Approval(address,address,uint256)')

/**
 * `ApprovalForAll(address,address,bool)` — разрешение на всю коллекцию.
 *
 * Самое опасное из существующих: одна подпись отдаёт распоряжение всеми
 * предметами коллекции, включая те, которых у владельца ещё нет.
 */
export const APPROVAL_FOR_ALL_TOPIC = eventTopic('ApprovalForAll(address,address,bool)')

/** `allowance(address,address)` — действующее разрешение ERC-20. */
export const ALLOWANCE_SELECTOR = functionSelector('allowance(address,address)')

/** `isApprovedForAll(address,address)` — действует ли разрешение на коллекцию. */
export const IS_APPROVED_FOR_ALL_SELECTOR = functionSelector('isApprovedForAll(address,address)')

/** `approve(address,uint256)` — выдача и отзыв разрешения ERC-20. */
export const APPROVE_SELECTOR = functionSelector('approve(address,uint256)')

/** `setApprovalForAll(address,bool)` — выдача и отзыв разрешения на коллекцию. */
export const SET_APPROVAL_FOR_ALL_SELECTOR = functionSelector('setApprovalForAll(address,bool)')

/** Число тем у события `Approval` ERC-20: идентификатор плюс два адреса. */
export const ERC20_APPROVAL_TOPIC_COUNT = 3

/**
 * Кодирует чтение действующего разрешения.
 *
 * Порядок аргументов задан стандартом: сначала владелец, затем тот,
 * кому разрешено. Перепутать их значит прочитать чужое разрешение
 * и показать владельцу, что он ничего не выдавал.
 */
export function encodeAllowance(selector: string, owner: Address, spender: Address): HexString {
  return encodeCallWithTwoAddresses(selector, owner, spender)
}

/**
 * Кодирует отзыв разрешения ERC-20.
 *
 * ОТЗЫВ — ЭТО ВЫДАЧА НУЛЯ. Отдельной функции «отозвать» в стандарте
 * нет: разрешение перезаписывается значением, и ноль означает
 * «распоряжаться нечем».
 */
export function encodeRevokeAllowance(spender: Address): HexString {
  return `0x${APPROVE_SELECTOR}${encodeAddressWord(spender)}${encodeUintWord(0n)}` as HexString
}

/**
 * Кодирует отзыв разрешения на коллекцию.
 *
 * Логическое значение занимает целое слово: ложь — слово из нулей.
 */
export function encodeRevokeApprovalForAll(operator: Address): HexString {
  return `0x${SET_APPROVAL_FOR_ALL_SELECTOR}${encodeAddressWord(operator)}${encodeUintWord(0n)}` as HexString
}
