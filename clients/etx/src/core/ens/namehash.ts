import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type { Address, HexString } from '@/core/types'

/** Длина узла ENS в байтах. Задана EIP-137 и настройке не подлежит. */
const NODE_LENGTH = 32

/**
 * Суффикс, под которым живут обратные записи.
 *
 * EIP-181: адрес `0xAbC…` имеет обратную запись в узле
 * `abc….addr.reverse`, где адрес записан в НИЖНЕМ регистре и без `0x`.
 * Запись в контрольной сумме EIP-55 дала бы другой узел и, как следствие,
 * «обратной записи нет» у адреса, у которого она есть.
 */
const REVERSE_SUFFIX = 'addr.reverse'

/**
 * Вычисляет узел ENS по имени — алгоритм namehash из EIP-137.
 *
 * ```
 * namehash('')          = 0x00…00
 * namehash('a.b')       = keccak256(namehash('b') ‖ keccak256('a'))
 * ```
 *
 * ПОЧЕМУ РЕАЛИЗОВАНО ЗДЕСЬ, А НЕ ВЗЯТО ИЗ БИБЛИОТЕКИ. Это не криптография,
 * а композиция готового keccak256, взятого из `@noble/hashes`: собственных
 * хэш-функций тут не появляется. Реализация умещается в десяток строк
 * и проверяется эталонными значениями из текста стандарта, поэтому
 * отдельная зависимость ради неё веса не окупает.
 *
 * ИМЯ ОБЯЗАНО БЫТЬ УЖЕ НОРМАЛИЗОВАНО. Функция хэширует то, что получила,
 * байт в байт: `Vitalik.eth` и `vitalik.eth` дадут разные узлы. Приводить
 * имя к каноническому виду — задача `normalizeEnsName`, и вызывать
 * namehash в обход неё нельзя.
 */
export function namehash(name: string): HexString {
  let node = new Uint8Array(NODE_LENGTH)

  if (name !== '') {
    /* Метки обходятся справа налево: узел строится от корня вниз. */
    for (const label of name.split('.').reverse()) {
      const joined = new Uint8Array(NODE_LENGTH * 2)

      joined.set(node, 0)
      joined.set(keccak_256(utf8ToBytes(label)), NODE_LENGTH)

      node = keccak_256(joined)
    }
  }

  return `0x${bytesToHex(node)}` as HexString
}

/**
 * Узел обратной записи для адреса.
 *
 * @param address Адрес в любом регистре. Приводится к нижнему по EIP-181.
 */
export function reverseNode(address: Address): HexString {
  return namehash(`${address.slice(2).toLowerCase()}.${REVERSE_SUFFIX}`)
}
