import { beforeEach, describe, expect, it } from 'vitest'

import { SecretBuffer } from '@/core/encryption'
import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPrivateKeyError,
  SecretBufferWipedError,
} from '@/core/errors'
import { EIP55_ADDRESSES } from '@/core/hdwallet/vectors'

import { DEAD_ADDRESS, ZERO_ADDRESS, toAddress } from './Address'
import { AddressService } from './AddressService'
import { PUBLIC_KEY_FORMAT } from './types'

/**
 * Порядок группы secp256k1. Приватный ключ обязан лежать в 1..n-1.
 * Значение закреплено стандартом SEC 2 и приводится в спецификации кривой.
 */
const CURVE_ORDER_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Приватный ключ, равный единице.
 *
 * Соответствующий публичный ключ — точка-генератор кривой, а адрес
 * общеизвестен и постоянно приводится в документации. Это делает его
 * пригодным эталоном для проверки всей цепочки
 * «приватный ключ -> публичный ключ -> keccak256 -> EIP-55».
 */
const PRIVATE_KEY_ONE = fromHex('0000000000000000000000000000000000000000000000000000000000000001')
const ADDRESS_OF_KEY_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
const PUBLIC_KEY_OF_ONE_COMPRESSED =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const PUBLIC_KEY_OF_ONE_UNCOMPRESSED =
  '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'

let service: AddressService

beforeEach(() => {
  service = new AddressService()
})

describe('AddressService: разбор и контрольная сумма', () => {
  it.each(EIP55_ADDRESSES)('приводит %s к каноническому виду', (address) => {
    expect(service.checksum(address.toLowerCase())).toBe(address)
  })

  it('принимает адрес в нижнем регистре', () => {
    expect(service.parse('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('отвергает неверную контрольную сумму', () => {
    expect(() => service.parse('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('отвергает строку не в формате адреса', () => {
    expect(() => service.parse('0x123')).toThrow(InvalidAddressError)
  })

  it('подтверждает корректность без исключения', () => {
    expect(service.isValid('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
    expect(service.isValid('мусор')).toBe(false)
  })

  it('сравнивает адреса без учёта регистра', () => {
    expect(
      service.equals(
        '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'.toLowerCase(),
      ),
    ).toBe(true)
  })
})

describe('AddressService: двоичное представление', () => {
  it('преобразует адрес в 20 байт', () => {
    const bytes = service.toBytes(toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'))

    expect(bytes).toHaveLength(20)
    expect(toHex(bytes)).toBe('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
  })

  it('восстанавливает адрес из байтов в контрольной сумме', () => {
    const bytes = fromHex('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')

    expect(service.fromBytes(bytes)).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
  })

  it('обратим для всех эталонных адресов EIP-55', () => {
    for (const address of EIP55_ADDRESSES) {
      expect(service.fromBytes(service.toBytes(toAddress(address)))).toBe(address)
    }
  })

  it('отвергает массив неверной длины', () => {
    expect(() => service.fromBytes(new Uint8Array(19))).toThrow(InvalidAddressError)
    expect(() => service.fromBytes(new Uint8Array(21))).toThrow(InvalidAddressError)
  })
})

describe('AddressService: вывод из приватного ключа', () => {
  /* Полная цепочка secp256k1 -> Keccak-256 -> EIP-55 на эталоне,
     значение которого известно независимо от нашей реализации. */

  it('выводит публичный ключ в сжатой форме', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(toHex(service.getPublicKey(key))).toBe(PUBLIC_KEY_OF_ONE_COMPRESSED)
    } finally {
      key.wipe()
    }
  })

  it('выводит публичный ключ в несжатой форме', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(toHex(service.getPublicKey(key, PUBLIC_KEY_FORMAT.Uncompressed))).toBe(
        PUBLIC_KEY_OF_ONE_UNCOMPRESSED,
      )
    } finally {
      key.wipe()
    }
  })

  it('выводит адрес из приватного ключа', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(service.fromPrivateKey(key)).toBe(ADDRESS_OF_KEY_ONE)
    } finally {
      key.wipe()
    }
  })

  it('согласован с выводом адреса из публичного ключа', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      /* Два независимых пути обязаны сойтись. Расхождение означало бы,
         что кошелёк показывает адрес, которым не сможет подписать. */
      expect(service.fromPrivateKey(key)).toBe(service.fromPublicKey(service.getPublicKey(key)))
    } finally {
      key.wipe()
    }
  })

  it('не затирает переданный буфер: владение остаётся за вызывающим', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      service.fromPrivateKey(key)

      expect(key.isWiped).toBe(false)
    } finally {
      key.wipe()
    }
  })

  it('отказывается работать с затёртым буфером', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)
    key.wipe()

    expect(() => service.fromPrivateKey(key)).toThrow(SecretBufferWipedError)
  })
})

describe('AddressService: проверка приватного ключа', () => {
  /* Недостаточно проверить длину: допустимы только значения 1..n-1.
     Ключ вне диапазона не задаёт точку на кривой, и его приём привёл бы
     к адресу, отличному от показанного пользователю. */

  it('принимает ключ из допустимого диапазона', () => {
    expect(service.isValidPrivateKey(PRIVATE_KEY_ONE)).toBe(true)
  })

  it('отвергает нулевой ключ', () => {
    expect(service.isValidPrivateKey(new Uint8Array(32))).toBe(false)
  })

  it('отвергает ключ, равный порядку группы', () => {
    expect(service.isValidPrivateKey(fromHex(CURVE_ORDER_HEX))).toBe(false)
  })

  it('отвергает ключ больше порядка группы', () => {
    expect(service.isValidPrivateKey(new Uint8Array(32).fill(0xff))).toBe(false)
  })

  it('принимает наибольший допустимый ключ n-1', () => {
    const maximum = fromHex(CURVE_ORDER_HEX)
    maximum.set([0x40], 31)

    expect(service.isValidPrivateKey(maximum)).toBe(true)
  })

  it('отвергает ключ неверной длины', () => {
    expect(service.isValidPrivateKey(new Uint8Array(31))).toBe(false)
    expect(service.isValidPrivateKey(new Uint8Array(33))).toBe(false)
  })

  it('бросает исключение при выводе адреса из непригодного ключа', () => {
    const key = SecretBuffer.allocate(32)

    try {
      expect(() => service.fromPrivateKey(key)).toThrow(InvalidPrivateKeyError)
    } finally {
      key.wipe()
    }
  })
})

describe('AddressService: невосстановимые адреса', () => {
  it('распознаёт нулевой адрес', () => {
    expect(service.isZero(ZERO_ADDRESS)).toBe(true)
    expect(service.isZero('0x0000000000000000000000000000000000000000')).toBe(true)
  })

  it('не считает нулевым обычный адрес', () => {
    expect(service.isZero(ADDRESS_OF_KEY_ONE)).toBe(false)
  })

  it('распознаёт общепринятый адрес сжигания', () => {
    expect(service.isBurn(DEAD_ADDRESS)).toBe(true)
  })

  it('считает нулевой адрес невосстановимым', () => {
    expect(service.isBurn(ZERO_ADDRESS)).toBe(true)
  })

  it('не срабатывает на обычном адресе', () => {
    /* Ложное срабатывание заставило бы пользователя отменить
       законный перевод, поэтому эвристика намеренно узкая. */
    expect(service.isBurn(ADDRESS_OF_KEY_ONE)).toBe(false)

    for (const address of EIP55_ADDRESSES) {
      expect(service.isBurn(address)).toBe(false)
    }
  })

  it('распознаёт адреса сжигания независимо от регистра', () => {
    expect(service.isBurn(DEAD_ADDRESS.toLowerCase())).toBe(true)
  })

  it('константы адресов проходят проверку контрольной суммы', () => {
    expect(() => toAddress(ZERO_ADDRESS)).not.toThrow()
    expect(() => toAddress(DEAD_ADDRESS)).not.toThrow()
  })
})

describe('AddressService: согласованность с чистыми функциями', () => {
  /* Класс обязан оставаться тонкой обёрткой. Появление собственной
     логики вычисления адреса — прямая угроза: две реализации разойдутся. */

  it('parse совпадает с toAddress', () => {
    for (const address of EIP55_ADDRESSES) {
      expect(service.parse(address)).toBe(toAddress(address))
    }
  })

  it('fromPublicKey совпадает с прямым вызовом', () => {
    const publicKey = fromHex(PUBLIC_KEY_OF_ONE_COMPRESSED)

    expect(service.fromPublicKey(publicKey)).toBe(ADDRESS_OF_KEY_ONE)
  })
})
