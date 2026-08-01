import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Проверка адреса EVM и его контрольной суммы EIP-55.
 *
 * ЗАЧЕМ ЭТО НУЖНО СЕРВИСУ, КОТОРЫЙ АДРЕСА ТОЛЬКО РАЗДАЁТ. Каталог
 * составляется людьми, а шестнадцатеричный адрес непроверяем при чтении:
 * ошибка в одном символе даёт другой контракт. Контрольная сумма EIP-55
 * ловит такую опечатку при загрузке каталога — то есть до того, как
 * ошибочный адрес разойдётся по кошелькам пользователей.
 *
 * Реализация опирается на keccak-256 из проверенной библиотеки;
 * собственных криптографических примитивов здесь нет.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u

/** Соответствует ли строка виду адреса EVM. */
export function hasAddressShape(value: string): boolean {
  return ADDRESS_PATTERN.test(value)
}

/**
 * Приводит адрес к записи с контрольной суммой EIP-55.
 *
 * Регистр букв кодирует хэш адреса: каждая буква поднимается в верхний
 * регистр, если соответствующий полубайт хэша не меньше восьми.
 *
 * @throws Error если строка не имеет вида адреса.
 */
export function toChecksumAddress(value: string): string {
  if (!hasAddressShape(value)) {
    throw new Error(`Строка не является адресом EVM: ${value}`)
  }

  const body = value.slice(2).toLowerCase()
  const hash = bytesToHex(keccak_256(utf8ToBytes(body)))

  let result = '0x'

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? ''
    const hashDigit = hash[index] ?? '0'

    result += Number.parseInt(hashDigit, 16) >= 8 ? character.toUpperCase() : character
  }

  return result
}

/**
 * Записан ли адрес с верной контрольной суммой EIP-55.
 *
 * Адрес целиком в нижнем либо целиком в верхнем регистре контрольной
 * суммы не несёт и проверку не проходит: в каталоге такая запись
 * означала бы, что адрес никем не сверялся.
 */
export function hasValidChecksum(value: string): boolean {
  return hasAddressShape(value) && toChecksumAddress(value) === value
}
