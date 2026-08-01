import { describe, expect, it } from 'vitest'

import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPublicKeyError,
} from '@/core/errors'
import { EIP55_ADDRESSES } from '@/core/hdwallet/vectors'

import {
  areAddressesEqual,
  isValidAddress,
  publicKeyToAddress,
  toAddress,
  toChecksumAddress,
} from './Address'

describe('toChecksumAddress: официальные примеры EIP-55', () => {
  it.each(EIP55_ADDRESSES)('приводит %s к каноническому виду', (address) => {
    expect(toChecksumAddress(address.toLowerCase())).toBe(address)
  })

  it('даёт тот же результат для входа в верхнем регистре', () => {
    const [first] = EIP55_ADDRESSES

    expect(toChecksumAddress((first as string).toUpperCase().replace('0X', '0x'))).toBe(first)
  })

  it('идемпотентен', () => {
    const [first] = EIP55_ADDRESSES

    expect(toChecksumAddress(toChecksumAddress(first as string))).toBe(first)
  })
})

describe('toAddress: проверка формата', () => {
  it('принимает адрес в нижнем регистре', () => {
    expect(toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('принимает адрес в верхнем регистре', () => {
    expect(toAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('принимает корректный адрес с контрольной суммой', () => {
    const [first] = EIP55_ADDRESSES

    expect(toAddress(first as string)).toBe(first)
  })

  it('отвергает строку без префикса 0x', () => {
    expect(() => toAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toThrow(InvalidAddressError)
  })

  it('отвергает слишком короткий адрес', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea')).toThrow(InvalidAddressError)
  })

  it('отвергает слишком длинный адрес', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedff')).toThrow(
      InvalidAddressError,
    )
  })

  it('отвергает недопустимые символы', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaez')).toThrow(
      InvalidAddressError,
    )
  })

  it('отвергает пустую строку', () => {
    expect(() => toAddress('')).toThrow(InvalidAddressError)
  })
})

describe('toAddress: контрольная сумма ловит опечатки', () => {
  /* Ключевое поведение всего модуля. Адрес EVM не имеет собственной
     контрольной суммы, поэтому опечатка даёт другой синтаксически
     корректный адрес, приватного ключа к которому не существует ни у кого.
     Средства, отправленные туда, теряются безвозвратно. */

  it('отвергает смешанный регистр с неверной контрольной суммой', () => {
    expect(() => toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('не исправляет молча неверную контрольную сумму', () => {
    /* Приведение такого адреса к правильному регистру лишило бы EIP-55
       единственного смысла: пользователь получил бы «исправленный» адрес
       с опечаткой в самих символах. */
    expect(() => toAddress('0xD1220a0cf47c7B9Be7A2E6BA89F429762e7b9aDb')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('обнаруживает подмену одного символа в адресе с контрольной суммой', () => {
    const tampered = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee'

    expect(() => toAddress(tampered)).toThrow(AddressChecksumMismatchError)
  })
})

describe('isValidAddress', () => {
  it('подтверждает корректный адрес', () => {
    expect(isValidAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
  })

  it('подтверждает адрес в нижнем регистре', () => {
    expect(isValidAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
  })

  it('отклоняет неверную контрольную сумму', () => {
    expect(isValidAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false)
  })

  it('отклоняет мусор', () => {
    expect(isValidAddress('не адрес')).toBe(false)
  })
})

describe('areAddressesEqual', () => {
  it('сравнивает без учёта регистра', () => {
    expect(
      areAddressesEqual(
        '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
      ),
    ).toBe(true)
  })

  it('различает разные адреса', () => {
    const [first, second] = EIP55_ADDRESSES

    expect(areAddressesEqual(first as string, second as string)).toBe(false)
  })
})

describe('publicKeyToAddress', () => {
  /* Публичный ключ точки-генератора secp256k1 — общеизвестное значение,
     и адрес приватного ключа 0x01 постоянно приводится в документации. */
  const GENERATOR_COMPRESSED = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  const GENERATOR_UNCOMPRESSED =
    '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
  const EXPECTED_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'

  function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    }

    return bytes
  }

  it('выводит адрес из сжатого ключа', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_COMPRESSED))).toBe(EXPECTED_ADDRESS)
  })

  it('выводит адрес из несжатого ключа', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_UNCOMPRESSED))).toBe(EXPECTED_ADDRESS)
  })

  it('выводит адрес из ключа без префикса', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_UNCOMPRESSED).slice(1))).toBe(EXPECTED_ADDRESS)
  })

  it('возвращает адрес в контрольной сумме EIP-55', () => {
    const address = publicKeyToAddress(fromHex(GENERATOR_COMPRESSED))

    expect(address).not.toBe(address.toLowerCase())
    expect(() => toAddress(address)).not.toThrow()
  })

  it('отвергает ключ недопустимой длины', () => {
    expect(() => publicKeyToAddress(new Uint8Array(32))).toThrow(InvalidPublicKeyError)
  })

  it('отвергает несжатый ключ без байта 0x04', () => {
    const wrong = fromHex(GENERATOR_UNCOMPRESSED)
    wrong[0] = 0x05

    expect(() => publicKeyToAddress(wrong)).toThrow(InvalidPublicKeyError)
  })

  it('отвергает точку вне кривой', () => {
    const invalid = fromHex(GENERATOR_COMPRESSED)
    /* Порча координаты X: восстановить Y для такой точки нельзя,
       поэтому ключ обязан быть отвергнут, а не превращён в адрес,
       к которому не существует приватного ключа. */
    invalid.set([(invalid[32] as number) ^ 0xff], 32)

    expect(() => publicKeyToAddress(invalid)).toThrow(InvalidPublicKeyError)
  })
})
