import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  MAX_UINT256,
  WORD_LENGTH,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeAddressWord,
  encodeCallWithTwoAddresses,
  encodeUintWord,
  eventTopic,
  functionSelector,
  readAddressWord,
} from './encoding'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Селекторы и темы', () => {
  it('селектор совпадает со стандартным', () => {
    /* Общеизвестное значение: `transfer(address,uint256)` даёт
       `a9059cbb`. Оно же выходит из вычисления. */
    expect(functionSelector('transfer(address,uint256)')).toBe('a9059cbb')
  })

  it('тема события длиннее селектора', () => {
    /* Событие занимает все тридцать два байта, функция — первые
       четыре. Перепутать их значит искать в журналах то, чего там нет,
       и получать пустой список без единого сообщения об ошибке. */
    const topic = eventTopic('Transfer(address,address,uint256)')

    expect(topic).toHaveLength(2 + WORD_LENGTH)
    expect(topic.slice(2, 10)).toBe(functionSelector('Transfer(address,address,uint256)'))
  })
})

describe('Кодирование слов', () => {
  it('адрес выравнивается вправо и приводится к нижнему регистру', () => {
    /* Контракт сравнивает байты: запись с контрольной суммой EIP-55
       читалась бы как другое значение. */
    const word = encodeAddressWord(OWNER)

    expect(word).toHaveLength(WORD_LENGTH)
    expect(word.slice(0, 24)).toBe('0'.repeat(24))
    expect(word.slice(24)).toBe(OWNER.slice(2).toLowerCase())
  })

  it('число выравнивается вправо', () => {
    expect(encodeUintWord(1n)).toBe('1'.padStart(WORD_LENGTH, '0'))
  })

  it('отрицательное число отвергается', () => {
    expect(() => encodeUintWord(-1n)).toThrow(RangeError)
  })

  it('число сверх uint256 отвергается', () => {
    /* Молча обрезанное значение дало бы вызов с другой суммой либо
       про другой предмет. */
    expect(() => encodeUintWord(MAX_UINT256 + 1n)).toThrow(RangeError)
  })

  it('два адреса идут в объявленном порядке', () => {
    const encoded = encodeCallWithTwoAddresses('dd62ed3e', OWNER, SPENDER)

    expect(encoded.slice(10, 74)).toContain(OWNER.slice(2).toLowerCase())
    expect(encoded.slice(74)).toContain(SPENDER.slice(2).toLowerCase())
  })
})

describe('Чтение адреса из слова', () => {
  it('правильно выровненное слово читается', () => {
    expect(readAddressWord(encodeAddressWord(OWNER))?.toLowerCase()).toBe(OWNER.toLowerCase())
  })

  it('слово с ненулевыми старшими байтами адресом не считается', () => {
    /* ЭТО ПРОВЕРКА БЕЗОПАСНОСТИ. Прочитав такое слово как адрес,
       кошелёк показал бы на экране подтверждения получателя, которого
       в вызове нет. */
    expect(readAddressWord('f'.repeat(WORD_LENGTH))).toBeNull()
  })

  it('слово неверной длины отвергается', () => {
    expect(readAddressWord('00ff')).toBeNull()
  })

  it('адрес возвращается с контрольной суммой', () => {
    /* Показанный в нижнем регистре, он лишает пользователя
       единственной защиты от опечатки при сверке. */
    expect(readAddressWord(encodeAddressWord(OWNER))).toBe(OWNER)
  })
})

describe('Чтение ответов контракта', () => {
  it('число читается из первого слова', () => {
    expect(decodeUint(`0x${encodeUintWord(42n)}` as HexString)).toBe(42n)
  })

  it('пустой ответ на число — ошибка', () => {
    /* Пустой ответ означает, что функции нет. Подставить ноль значило бы
       выдать отсутствие функции за нулевое значение. */
    expect(() => decodeUint('0x' as HexString)).toThrow()
  })

  it('пустой ответ на логическое значение означает «нет»', () => {
    /* У ERC-165 это законный случай: старые контракты интерфейс
       не объявляют. */
    expect(decodeBool('0x' as HexString)).toBe(false)
  })

  it('ненулевое слово означает «да»', () => {
    expect(decodeBool(`0x${encodeUintWord(1n)}` as HexString)).toBe(true)
  })

  it('адрес читается из ответа', () => {
    expect(decodeAddress(`0x${encodeAddressWord(OWNER)}` as HexString)).toBe(OWNER)
  })

  it('ответ короче слова отвергается', () => {
    expect(() => decodeAddress('0x00ff' as HexString)).toThrow()
  })

  it('заполненное слово адресом не признаётся', () => {
    expect(() => decodeAddress(`0x${'f'.repeat(WORD_LENGTH)}` as HexString)).toThrow()
  })
})
