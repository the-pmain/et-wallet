import { WORD_LENGTH, readAddressWord, strip } from '@/core/abi'
import { toAddress } from '@/core/address'
import { functionSelector } from '@/core/token'
import { toChainId, type Address, type ChainId, type HexString } from '@/core/types'

/**
 * Сеть, в которой живёт реестр ENS.
 *
 * ENS развёрнут в Ethereum. Имя, разрешённое здесь, действительно
 * и в других сетях — адресное пространство EVM общее, — но сам реестр
 * существует в одном экземпляре и в одной цепи.
 */
export const ENS_CHAIN_ID: ChainId = toChainId(1)

/**
 * Адрес реестра ENS.
 *
 * ЗАПИСАН В НИЖНЕМ РЕГИСТРЕ И ПРОПУЩЕН ЧЕРЕЗ `toAddress` НАМЕРЕННО.
 * Контрольная сумма EIP-55 вычисляется, а не переписывается: сорок
 * символов, скопированных из памяти вместе с регистром, непроверяемы
 * при чтении, а ошибка в регистре дала бы отказ `toAddress` вместо
 * работающего кошелька.
 *
 * САМО ЗНАЧЕНИЕ ПРОВЕРЕНО ЖИВЫМ ЗАПРОСОМ, а не взято из памяти: вызов
 * `resolver(namehash('vitalik.eth'))` по этому адресу возвращает
 * действующий резолвер, а тот — адрес, который обратным разрешением
 * даёт то же имя. Неверный адрес реестра дал бы нули на первом же шаге.
 * Тест `EnsService.test.ts` повторяет эту цепочку на дублёре.
 */
export const ENS_REGISTRY_ADDRESS: Address = toAddress('0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e')

/** `resolver(bytes32)` — адрес резолвера узла. Метод реестра. */
export const ENS_RESOLVER_SELECTOR = functionSelector('resolver(bytes32)')

/** `addr(bytes32)` — адрес, на который указывает имя. Метод резолвера, EIP-137. */
export const ENS_ADDR_SELECTOR = functionSelector('addr(bytes32)')

/** `name(bytes32)` — имя, объявленное для адреса. Метод резолвера, EIP-181. */
export const ENS_NAME_SELECTOR = functionSelector('name(bytes32)')

/** Вызов с одним аргументом-узлом. */
export function encodeNodeCall(selector: string, node: HexString): HexString {
  return `0x${selector}${node.slice(2)}` as HexString
}

/**
 * Читает адрес из ответа контракта.
 *
 * НУЛЕВОЙ АДРЕС ВОЗВРАЩАЕТСЯ КАК `null`, И ЭТО ГЛАВНОЕ В ЭТОЙ ФУНКЦИИ.
 * Реестр отвечает нулём на любой незарегистрированный узел, а резолвер —
 * на отсутствующую запись. Приняв этот ноль за адрес получателя, кошелёк
 * отправил бы средства в сжигающий адрес, из которого их не достанет
 * никто. Отсутствие записи и адрес — разные утверждения.
 *
 * @returns Адрес либо `null`, если ответ пуст, нулевой или короче слова.
 */
export function decodeAddressWord(data: HexString): Address | null {
  const body = strip(data)

  if (body.length < WORD_LENGTH) {
    return null
  }

  /* Выравнивание проверяет общий разбор: слово с ненулевыми старшими
     байтами адресом не является. Прежде эта проверка стояла здесь
     собственным выражением — третьей копией одного правила. */
  const address = readAddressWord(body.slice(0, WORD_LENGTH))

  if (address === null) {
    return null
  }

  const hex = address.toLowerCase()

  if (/^0x0{40}$/.test(hex)) {
    return null
  }

  return toAddress(hex)
}

/**
 * Читает строку из ответа контракта.
 *
 * Формат ABI для `string`: смещение, длина, содержимое. Разбор нарочно
 * строгий — ответ приходит от контракта, который мы не писали, и любое
 * несоответствие означает «прочитать не удалось», а не «имени нет».
 *
 * @returns Строка либо `null`, если ответ пуст либо не разбирается.
 */
export function decodeStringResult(data: HexString): string | null {
  const body = data.startsWith('0x') ? data.slice(2) : data

  if (body.length < WORD_LENGTH * 2) {
    return null
  }

  const offset = Number(BigInt(`0x${body.slice(0, WORD_LENGTH)}`)) * 2
  const lengthStart = offset

  if (!Number.isSafeInteger(offset) || body.length < lengthStart + WORD_LENGTH) {
    return null
  }

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + WORD_LENGTH)}`)) * 2
  const contentStart = lengthStart + WORD_LENGTH

  if (!Number.isSafeInteger(length) || body.length < contentStart + length) {
    return null
  }

  if (length === 0) {
    return null
  }

  const bytes = new Uint8Array(length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      body.slice(contentStart + index * 2, contentStart + index * 2 + 2),
      16,
    )
  }

  /* `fatal: true` — недопустимая последовательность UTF-8 приводит
     к отказу, а не к символам замены. Имя, которое не является текстом,
     показывать нельзя: именно так подделывают строки на экране. */
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
