import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPublicKeyError,
} from '@/core/errors'
import type { Address } from '@/core/types'

import {
  ADDRESS_BYTE_LENGTH,
  COMPRESSED_PUBLIC_KEY_LENGTH,
  RAW_PUBLIC_KEY_LENGTH,
  UNCOMPRESSED_PUBLIC_KEY_LENGTH,
} from './types'

/** Адрес EVM: 20 байт, то есть 40 шестнадцатеричных символов после `0x`. */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** Порог полубайта хэша, при котором символ адреса становится заглавным. */
const CHECKSUM_UPPERCASE_THRESHOLD = 8

/**
 * Вычисляет контрольную сумму адреса по EIP-55.
 *
 * Алгоритм: keccak256 от адреса в нижнем регистре без префикса; далее
 * i-й символ адреса переводится в верхний регистр, если i-й полубайт хэша
 * не меньше 8.
 *
 * Зачем это нужно: адрес EVM не имеет собственной контрольной суммы,
 * поэтому опечатка в одном символе даёт другой синтаксически корректный
 * адрес. Средства, отправленные на него, теряются безвозвратно — приватного
 * ключа к нему не существует ни у кого. EIP-55 кодирует контрольную сумму
 * в регистре букв и ловит подавляющее большинство опечаток.
 *
 * @param value Адрес с префиксом `0x` в любом регистре.
 */
export function toChecksumAddress(value: string): Address {
  const lowercase = value.toLowerCase().slice(2)
  const hash = bytesToHex(keccak_256(utf8ToBytes(lowercase)))

  let result = '0x'

  for (let index = 0; index < lowercase.length; index += 1) {
    const character = lowercase[index] as string
    const hashNibble = Number.parseInt(hash[index] as string, 16)

    result += hashNibble >= CHECKSUM_UPPERCASE_THRESHOLD ? character.toUpperCase() : character
  }

  return result as Address
}

/**
 * Создаёт адрес с проверкой формата и контрольной суммы.
 *
 * Единственный допустимый способ получить значение типа `Address`.
 *
 * ПОВЕДЕНИЕ ПРИ РАЗНОМ РЕГИСТРЕ — ключевое место всего модуля:
 *
 * - Адрес целиком в нижнем либо целиком в верхнем регистре не несёт
 *   контрольной суммы. Проверять нечего, адрес просто приводится
 *   к каноническому виду.
 *
 * - Адрес со смешанным регистром контрольную сумму несёт, и она ПРОВЕРЯЕТСЯ.
 *   Несовпадение приводит к ошибке.
 *
 * Молчаливое исправление регистра у смешанного адреса недопустимо: именно
 * в этом случае EIP-55 обязан сработать. Кошелёк, который «чинит» такой
 * адрес, отправит средства по адресу с опечаткой, откуда их не вернуть.
 *
 * @throws InvalidAddressError при несоответствии формату.
 * @throws AddressChecksumMismatchError при несовпадении контрольной суммы.
 */
export function toAddress(value: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new InvalidAddressError(value)
  }

  const body = value.slice(2)
  const isSingleCase = body === body.toLowerCase() || body === body.toUpperCase()

  if (isSingleCase) {
    return toChecksumAddress(value)
  }

  const checksummed = toChecksumAddress(value)

  if (checksummed !== value) {
    throw new AddressChecksumMismatchError(value)
  }

  return checksummed
}

/** Проверка без выбрасывания исключения. Для валидации по мере ввода. */
export function isValidAddress(value: string): boolean {
  try {
    toAddress(value)
    return true
  } catch {
    return false
  }
}

/**
 * Сравнивает адреса без учёта регистра.
 *
 * Прямое сравнение строк ненадёжно: один и тот же адрес встречается
 * в нижнем регистре (ответы RPC), в верхнем (некоторые обозреватели)
 * и в контрольной сумме EIP-55. Сравнение без нормализации приводит
 * к тому, что собственный аккаунт не распознаётся в списке.
 */
export function areAddressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Преобразует адрес в 20 байт.
 *
 * Требуется при формировании данных вызова контракта и при подписи
 * транзакции: туда адрес уходит в двоичном виде, а не строкой.
 */
export function addressToBytes(address: Address): Uint8Array {
  const body = address.slice(2)
  const bytes = new Uint8Array(ADDRESS_BYTE_LENGTH)

  for (let index = 0; index < ADDRESS_BYTE_LENGTH; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

/**
 * Создаёт адрес из 20 байт.
 *
 * Результат всегда в контрольной сумме EIP-55: адрес, полученный
 * из двоичных данных, обязан выйти наружу в каноническом виде.
 *
 * @throws InvalidAddressError при неверной длине.
 */
export function addressFromBytes(bytes: Uint8Array): Address {
  if (bytes.length !== ADDRESS_BYTE_LENGTH) {
    throw new InvalidAddressError(
      `expected ${String(ADDRESS_BYTE_LENGTH)} bytes, received ${String(bytes.length)}`,
    )
  }

  return toChecksumAddress(`0x${bytesToHex(bytes)}`)
}

/**
 * Нулевой адрес.
 *
 * Средства, отправленные сюда, безвозвратны: приватного ключа к нему
 * не существует. Одновременно это штатное значение поля `to` при
 * развёртывании контракта, поэтому запрещать его нельзя — интерфейс
 * обязан различать эти два случая.
 */
export const ZERO_ADDRESS: Address = toChecksumAddress('0x0000000000000000000000000000000000000000')

/**
 * Общепринятый адрес сжигания.
 *
 * Не является чем-то особенным на уровне протокола: обычный адрес,
 * приватный ключ к которому никому не известен. Используется проектами
 * для демонстративного уничтожения токенов.
 */
export const DEAD_ADDRESS: Address = toChecksumAddress('0x000000000000000000000000000000000000dead')

/** Является ли адрес нулевым. */
export function isZeroAddress(address: string): boolean {
  return areAddressesEqual(address, ZERO_ADDRESS)
}

/**
 * Является ли адрес заведомо невосстановимым.
 *
 * Проверка эвристическая и намеренно узкая: перечислены только адреса,
 * общепризнанно используемые для сжигания. Расширять список догадками
 * нельзя — ложное срабатывание на реальном адресе получателя заставит
 * пользователя отменить законный перевод.
 *
 * Отправку такой адрес не запрещает: сжигание бывает намеренным.
 * Решение принимает пользователь, задача ядра — сообщить.
 */
export function isBurnAddress(address: string): boolean {
  return isZeroAddress(address) || areAddressesEqual(address, DEAD_ADDRESS)
}

/**
 * Выводит адрес EVM из публичного ключа.
 *
 * Адрес — последние 20 байт keccak256 от НЕСЖАТОГО публичного ключа
 * без байта префикса `0x04`, то есть от 64 байт координат X и Y.
 *
 * Принимаются три формы записи ключа:
 * - 33 байта, сжатая SEC1 (именно её отдаёт BIP-32);
 * - 65 байт, несжатая SEC1 с префиксом `0x04`;
 * - 64 байта, координаты без префикса.
 *
 * Сжатый ключ разворачивается через восстановление точки на кривой:
 * координата Y вычисляется из X по уравнению secp256k1. Операция
 * выполняется библиотекой `@noble/curves`; собственной реализации
 * арифметики на кривой здесь нет и быть не может.
 *
 * @throws InvalidPublicKeyError при недопустимой длине либо если точка
 *         не лежит на кривой.
 */
export function publicKeyToAddress(publicKey: Uint8Array): Address {
  const raw = toRawPublicKey(publicKey)
  const hash = keccak_256(raw)

  return addressFromBytes(hash.slice(hash.length - ADDRESS_BYTE_LENGTH))
}

/** Приводит публичный ключ к 64 байтам координат X и Y. */
function toRawPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === RAW_PUBLIC_KEY_LENGTH) {
    return publicKey
  }

  if (publicKey.length === UNCOMPRESSED_PUBLIC_KEY_LENGTH) {
    if (publicKey[0] !== 0x04) {
      throw new InvalidPublicKeyError('an uncompressed key must start with the byte 0x04')
    }

    return publicKey.slice(1)
  }

  if (publicKey.length === COMPRESSED_PUBLIC_KEY_LENGTH) {
    try {
      /* Восстановление точки проверяет, что она лежит на кривой.
         Ключ, не проходящий проверку, отвергается, а не превращается
         в адрес, к которому не существует приватного ключа. */
      return secp256k1.Point.fromBytes(publicKey).toBytes(false).slice(1)
    } catch (error) {
      throw new InvalidPublicKeyError('the point is not on the secp256k1 curve', { cause: error })
    }
  }

  throw new InvalidPublicKeyError(
    `allowed lengths are ${String(COMPRESSED_PUBLIC_KEY_LENGTH)}, ` +
      `${String(RAW_PUBLIC_KEY_LENGTH)} and ${String(UNCOMPRESSED_PUBLIC_KEY_LENGTH)} bytes, ` +
      `received ${String(publicKey.length)}`,
  )
}
