import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  TRANSFER_SELECTOR,
  decodeString,
  decodeTransfer,
  decodeUint,
  encodeTransfer,
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

describe('Кодирование перевода', () => {
  /* Эталон: вызов transfer к 0xfB69…d359 на 1 000 000 единиц.
     Селектор 0xa9059cbb — общеизвестное значение, и оно же выходит
     из keccak256('transfer(address,uint256)'). */
  const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

  it('селектор совпадает со стандартным', () => {
    expect(TRANSFER_SELECTOR).toBe('a9059cbb')
  })

  it('собирает вызов из селектора и двух слов', () => {
    expect(encodeTransfer(RECIPIENT, 1_000_000n)).toBe(
      '0xa9059cbb' +
        '000000000000000000000000fb6916095ca1df60bb79ce92ce3ea74c37c5d359' +
        '00000000000000000000000000000000000000000000000000000000000f4240',
    )
  })

  it('приводит адрес к нижнему регистру', () => {
    /* Контракт сравнивает байты. Запись с контрольной суммой EIP-55
       дала бы другое значение слова. */
    expect(encodeTransfer(RECIPIENT, 1n)).toContain('fb6916095ca1df60bb79ce92ce3ea74c37c5d359')
  })

  it('данные вызова занимают ровно 68 байт', () => {
    /* Четыре байта селектора и два слова по 32. Лишние байты означали бы
       другой вызов. */
    expect(encodeTransfer(RECIPIENT, 1n)).toHaveLength(2 + 8 + 64 * 2)
  })

  it('отвергает сумму, не помещающуюся в uint256', () => {
    /* Молча обрезанное значение отправило бы не ту сумму, которую
       подтвердил пользователь. */
    expect(() => encodeTransfer(RECIPIENT, 1n << 256n)).toThrow(RangeError)
  })

  it('отвергает отрицательную сумму', () => {
    expect(() => encodeTransfer(RECIPIENT, -1n)).toThrow(RangeError)
  })
})

describe('Разбор перевода', () => {
  const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

  it('читает получателя и сумму обратно', () => {
    const decoded = decodeTransfer(encodeTransfer(RECIPIENT, 123_456n))

    expect(decoded?.to.toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(decoded?.amount).toBe(123_456n)
  })

  it('не признаёт переводом пустые данные', () => {
    expect(decodeTransfer('0x' as HexString)).toBeNull()
  })

  it('не признаёт переводом чужой вызов', () => {
    expect(decodeTransfer(encodeCallWithAddress(BALANCE_OF_SELECTOR, RECIPIENT))).toBeNull()
  })

  it('не признаёт переводом вызов с лишними данными', () => {
    /* Тот же селектор с третьим словом — другая функция. Прочитать
       из неё получателя значило бы показать в истории перевод,
       которого не было. */
    expect(
      decodeTransfer(`${encodeTransfer(RECIPIENT, 1n)}${'0'.repeat(64)}` as HexString),
    ).toBeNull()
  })

  it('не признаёт адресом слово с ненулевыми старшими байтами', () => {
    /* Адрес занимает младшие двадцать байт. Слово, заполненное целиком,
       адресом не является, и выдавать его за адрес нельзя. */
    const forged = `0xa9059cbb${'f'.repeat(64)}${'0'.repeat(64)}` as HexString

    expect(decodeTransfer(forged)).toBeNull()
  })
})
