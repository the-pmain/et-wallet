import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  decodeString,
  decodeUint,
  encodeCall,
  encodeCallWithAddress,
} from './erc20'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

/** Дополняет значение до слова ABI слева нулями. */
function word(value: string): string {
  return value.padStart(64, '0')
}

/** Кодирует текст в шестнадцатеричные байты. */
function utf8(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('Селекторы функций', () => {
  it('вычисляются, а не берутся из константы', () => {
    /* Значения опубликованы в стандарте ERC-20 и одинаковы во всех
       реализациях. Ошибка в одном символе дала бы вызов несуществующей
       функции и отказ контракта без внятной причины. */
    expect(DECIMALS_SELECTOR).toBe('313ce567')
    expect(SYMBOL_SELECTOR).toBe('95d89b41')
    expect(NAME_SELECTOR).toBe('06fdde03')
    expect(BALANCE_OF_SELECTOR).toBe('70a08231')
  })

  it('имеют длину четыре байта', () => {
    for (const value of [DECIMALS_SELECTOR, SYMBOL_SELECTOR, NAME_SELECTOR, BALANCE_OF_SELECTOR]) {
      expect(value).toHaveLength(8)
    }
  })
})

describe('encodeCallWithAddress', () => {
  it('дополняет адрес до слова ABI', () => {
    const encoded = encodeCallWithAddress(BALANCE_OF_SELECTOR, OWNER)

    expect(encoded).toHaveLength(2 + 8 + 64)
    expect(encoded.startsWith(`0x${BALANCE_OF_SELECTOR}`)).toBe(true)
  })

  it('приводит адрес к нижнему регистру', () => {
    /* Контракт сравнивает байты: запись в контрольной сумме EIP-55
       читалась бы как другое значение. */
    expect(encodeCallWithAddress(BALANCE_OF_SELECTOR, OWNER)).toBe(
      `0x${BALANCE_OF_SELECTOR}${OWNER.slice(2).toLowerCase().padStart(64, '0')}`,
    )
  })

  it('кодирует вызов без аргументов одним селектором', () => {
    expect(encodeCall(DECIMALS_SELECTOR)).toBe(`0x${DECIMALS_SELECTOR}`)
  })
})

describe('decodeUint', () => {
  it('читает число десятичных знаков', () => {
    expect(decodeUint(`0x${word('6')}` as HexString)).toBe(6n)
    expect(decodeUint(`0x${word('12')}` as HexString)).toBe(18n)
  })

  it('не теряет точность на больших балансах', () => {
    const raw = 'f'.repeat(64)

    expect(decodeUint(`0x${raw}` as HexString)).toBe(2n ** 256n - 1n)
  })

  it('отвергает пустой ответ', () => {
    /* Пустой ответ означает, что функции в контракте нет: принять его
       за ноль значило бы показать нулевой баланс вместо ошибки. */
    expect(() => decodeUint('0x' as HexString)).toThrow()
  })
})

describe('decodeString: строка переменной длины', () => {
  it('читает символ токена', () => {
    const data = `0x${word('20')}${word('4')}${utf8('USDC').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('USDC')
  })

  it('читает имя с символами вне латиницы', () => {
    const name = 'Тестовый токен'
    const bytes = utf8(name)
    const data = `0x${word('20')}${word((bytes.length / 2).toString(16))}${bytes.padEnd(128, '0')}`

    expect(decodeString(data as HexString)).toBe(name)
  })

  it('читает смещение, а не предполагает его', () => {
    /* Стандарт не гарантирует смещения ровно в 32 байта. Жёсткое
       предположение сломалось бы на контракте с иной раскладкой. */
    const data = `0x${word('40')}${word('0')}${word('3')}${utf8('ABC').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('ABC')
  })

  it('отвергает ответ короче объявленного смещения', () => {
    const data = `0x${word('200')}${word('4')}`

    expect(() => decodeString(data as HexString)).toThrow()
  })
})

describe('decodeString: bytes32', () => {
  it('читает символ старого токена', () => {
    /* Токены, выпущенные до окончательной редакции стандарта, возвращают
       `bytes32` с дополнением нулями справа. MKR — самый известный.
       Декодер, понимающий только `string`, не добавил бы их вовсе. */
    const data = `0x${utf8('MKR').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('MKR')
  })

  it('обрезает дополнение нулями', () => {
    const data = `0x${utf8('DAI').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('DAI')
  })

  it('читает значение, занимающее всё слово', () => {
    const text = 'A'.repeat(32)
    const data = `0x${utf8(text)}`

    expect(decodeString(data as HexString)).toBe(text)
  })

  it('отвергает пустой ответ', () => {
    expect(() => decodeString('0x' as HexString)).toThrow()
  })
})
