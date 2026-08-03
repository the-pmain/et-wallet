import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { toAddress } from '@/core/address'
import type { Address, HexString } from '@/core/types'

/**
 * Идентификатор события в журнале — keccak256 от его подписи.
 *
 * ЗНАЧЕНИЯ ВЫЧИСЛЯЮТСЯ, А НЕ ВПИСЫВАЮТСЯ КОНСТАНТАМИ. Шестнадцатеричный
 * хэш, скопированный из памяти или со стороннего сайта, непроверяем
 * при чтении кода: ошибка в одном символе даёт пустую историю без
 * единого сообщения об ошибке. Подпись события читается и сверяется
 * со стандартом глазами, а вычисление воспроизводит определение
 * из спецификации.
 */
function eventTopic(signature: string): HexString {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(signature)))}` as HexString
}

/**
 * `Transfer(address,address,uint256)`.
 *
 * Общее событие ERC-20 и ERC-721. Различаются они числом индексированных
 * параметров: у ERC-20 индексированы отправитель и получатель (три темы
 * вместе с идентификатором события), у ERC-721 индексирован ещё
 * и `tokenId` (четыре темы). Это единственный надёжный признак —
 * в самом событии тип не указан.
 */
export const TRANSFER_TOPIC = eventTopic('Transfer(address,address,uint256)')

/** `TransferSingle(address,address,address,uint256,uint256)` — ERC-1155. */
export const TRANSFER_SINGLE_TOPIC = eventTopic(
  'TransferSingle(address,address,address,uint256,uint256)',
)

/** `TransferBatch(address,address,address,uint256[],uint256[])` — ERC-1155. */
export const TRANSFER_BATCH_TOPIC = eventTopic(
  'TransferBatch(address,address,address,uint256[],uint256[])',
)

/** Длина темы: 32 байта в шестнадцатеричной записи плюс префикс. */
const TOPIC_LENGTH = 66

/**
 * Кодирует адрес как тему журнала.
 *
 * Адрес занимает 20 байт, тема — 32, поэтому значение дополняется нулями
 * слева. Регистр приводится к нижнему: узел сравнивает темы побайтово,
 * и запись в контрольной сумме EIP-55 не совпала бы ни с чем.
 */
export function addressToTopic(address: Address): HexString {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as HexString
}

/**
 * Извлекает адрес из темы журнала.
 *
 * @throws InvalidAddressError если тема не содержит корректного адреса.
 */
export function topicToAddress(topic: HexString): Address {
  if (topic.length !== TOPIC_LENGTH) {
    throw new Error(`The log topic has a wrong length: ${String(topic.length)}`)
  }

  /* Адрес — последние 20 байт темы, то есть 40 последних символов. */
  return toAddress(`0x${topic.slice(-40)}`)
}

/**
 * Читает беззнаковое целое из шестнадцатеричной строки.
 *
 * Пустая строка и одиночный префикс означают ноль: узлы возвращают
 * `0x` для пустых данных, и `BigInt('0x')` на этом выбрасывает
 * исключение.
 */
export function hexToBigInt(value: string): bigint {
  return value === '' || value === '0x' ? 0n : BigInt(value)
}

/**
 * Разбирает поле `data` журнала на 32-байтовые слова.
 *
 * Все значения в журнале выровнены по 32 байта независимо от объявленного
 * типа — так устроена кодировка ABI.
 */
export function splitDataWords(data: HexString): readonly bigint[] {
  const body = data.startsWith('0x') ? data.slice(2) : data
  const words: bigint[] = []

  for (let offset = 0; offset + 64 <= body.length; offset += 64) {
    words.push(hexToBigInt(`0x${body.slice(offset, offset + 64)}`))
  }

  return words
}
