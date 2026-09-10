import { secp256k1 } from '@noble/curves/secp256k1.js'

import type { ISecretBuffer } from '@/core/encryption'
import { InvalidPrivateKeyError } from '@/core/errors'
import type { Address } from '@/core/types'

import { publicKeyToAddress } from './Address'
import { PRIVATE_KEY_LENGTH, PUBLIC_KEY_FORMAT, type PublicKeyFormat } from './types'

/**
 * Проверяет пригодность приватного ключа secp256k1.
 *
 * Недостаточно проверить длину: допустимы только значения от 1 до n-1,
 * где n — порядок группы. Нулевой ключ и любое значение, не меньшее n,
 * не задают точку на кривой.
 *
 * Проверка не декоративна. Ключ вне диапазона, принятый кошельком,
 * приведёт к одному из двух исходов: либо операция подписи упадёт
 * в неожиданном месте, либо — что хуже — приведение по модулю даст адрес,
 * отличный от показанного пользователю, и средства уйдут в никуда.
 *
 * @throws InvalidPrivateKeyError
 */
export function assertValidPrivateKey(privateKey: Uint8Array): void {
  if (privateKey.length !== PRIVATE_KEY_LENGTH) {
    throw new InvalidPrivateKeyError()
  }

  if (!secp256k1.utils.isValidSecretKey(privateKey)) {
    throw new InvalidPrivateKeyError()
  }
}

/** Проверка без выбрасывания исключения. Для валидации по мере ввода. */
export function isValidPrivateKey(privateKey: Uint8Array): boolean {
  try {
    assertValidPrivateKey(privateKey)
    return true
  } catch {
    return false
  }
}

/**
 * Вычисляет публичный ключ из приватного.
 *
 * Принимает `ISecretBuffer`, а не сырой массив, сознательно: это
 * заставляет вызывающий код владеть секретом явно и затирать его.
 * Приём `Uint8Array` позволял бы передать сюда буфер, за жизненным
 * циклом которого никто не следит.
 *
 * @throws InvalidPrivateKeyError, SecretBufferWipedError
 */
export function privateKeyToPublicKey(
  privateKey: ISecretBuffer,
  format: PublicKeyFormat = PUBLIC_KEY_FORMAT.Compressed,
): Uint8Array {
  const bytes = privateKey.bytes

  assertValidPrivateKey(bytes)

  return secp256k1.getPublicKey(bytes, format === PUBLIC_KEY_FORMAT.Compressed)
}

/**
 * Выводит адрес EVM непосредственно из приватного ключа.
 *
 * Нужен при импорте отдельного ключа: HD-дерева в этом случае нет,
 * и путь «приватный ключ -> публичный ключ -> keccak256 -> адрес»
 * проходится целиком.
 *
 * Публичный ключ запрашивается сразу в несжатой форме: именно она
 * участвует в вычислении адреса, и промежуточное разворачивание
 * сжатого ключа было бы лишней работой.
 *
 * @throws InvalidPrivateKeyError, SecretBufferWipedError
 */
export function privateKeyToAddress(privateKey: ISecretBuffer): Address {
  return publicKeyToAddress(privateKeyToPublicKey(privateKey, PUBLIC_KEY_FORMAT.Uncompressed))
}
