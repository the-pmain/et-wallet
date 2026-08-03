import {
  decodeAddress,
  decodeBool,
  encodeCallWithAddressAndUint,
  encodeCallWithUint,
  encodeUintWord,
} from '@/core/abi'
import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  ERC1155_BALANCE_OF_SELECTOR,
  OWNER_OF_SELECTOR,
  SAFE_TRANSFER_1155_SELECTOR,
  SAFE_TRANSFER_721_SELECTOR,
  SUPPORTS_INTERFACE_SELECTOR,
  encodeSafeTransfer1155,
  encodeSafeTransfer721,
  encodeSupportsInterface,
} from './abi'

const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Селекторы совпадают со стандартными', () => {
  /* Значения общеизвестны и публикуются в спецификациях; здесь они
     вычисляются из подписи, и совпадение подтверждает, что подпись
     записана верно. Ошибка в одном символе даёт вызов несуществующей
     функции и отказ контракта без внятной причины. */
  it.each([
    ['ownerOf(uint256)', OWNER_OF_SELECTOR, '6352211e'],
    ['balanceOf(address,uint256)', ERC1155_BALANCE_OF_SELECTOR, '00fdd58e'],
    ['supportsInterface(bytes4)', SUPPORTS_INTERFACE_SELECTOR, '01ffc9a7'],
    ['safeTransferFrom(address,address,uint256)', SAFE_TRANSFER_721_SELECTOR, '42842e0e'],
    [
      'safeTransferFrom(address,address,uint256,uint256,bytes)',
      SAFE_TRANSFER_1155_SELECTOR,
      'f242432a',
    ],
  ])('%s', (_signature, actual: string, expected: string) => {
    expect(actual).toBe(expected)
  })
})

describe('Кодирование аргументов', () => {
  it('число занимает ровно одно слово', () => {
    expect(encodeUintWord(1n)).toHaveLength(64)
  })

  it('отвергает число, не помещающееся в uint256', () => {
    /* Обрезать номер предмета молча нельзя: получился бы вызов
       про другой предмет. */
    expect(() => encodeUintWord(1n << 256n)).toThrow(RangeError)
  })

  it('отвергает отрицательное число', () => {
    expect(() => encodeUintWord(-1n)).toThrow(RangeError)
  })

  it('вызов с числом состоит из селектора и слова', () => {
    expect(encodeCallWithUint(OWNER_OF_SELECTOR, 777n)).toBe(
      `0x${OWNER_OF_SELECTOR}${'0'.repeat(61)}309`,
    )
  })

  it('вызов с адресом и числом кладёт адрес первым', () => {
    const encoded = encodeCallWithAddressAndUint(ERC1155_BALANCE_OF_SELECTOR, RECIPIENT, 5n)

    expect(encoded.slice(10, 74)).toContain(RECIPIENT.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(5n)
  })

  it('идентификатор интерфейса выравнивается влево', () => {
    /* `bytes4` дополняется нулями СПРАВА, в отличие от чисел и адресов.
       Перепутанное выравнивание даёт вопрос про другой интерфейс
       и молчаливое «не поддерживается». */
    expect(encodeSupportsInterface('0x80ac58cd')).toBe(
      `0x${SUPPORTS_INTERFACE_SELECTOR}80ac58cd${'0'.repeat(56)}`,
    )
  })
})

describe('Кодирование передачи предмета', () => {
  it('ERC-721: отправитель, получатель и номер по порядку', () => {
    const encoded = encodeSafeTransfer721(SENDER, RECIPIENT, 777n)

    expect(encoded.slice(0, 10)).toBe(`0x${SAFE_TRANSFER_721_SELECTOR}`)
    expect(encoded.slice(10, 74)).toContain(SENDER.slice(2).toLowerCase())
    expect(encoded.slice(74, 138)).toContain(RECIPIENT.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(138)}`)).toBe(777n)
  })

  it('ERC-721: данные вызова занимают ровно сто байт', () => {
    /* Четыре байта селектора и три слова по тридцать два. */
    expect(encodeSafeTransfer721(SENDER, RECIPIENT, 1n)).toHaveLength(2 + 8 + 64 * 3)
  })

  it('ERC-1155: количество идёт после номера', () => {
    const encoded = encodeSafeTransfer1155(SENDER, RECIPIENT, 5n, 3n)

    expect(BigInt(`0x${encoded.slice(138, 202)}`)).toBe(5n)
    expect(BigInt(`0x${encoded.slice(202, 266)}`)).toBe(3n)
  })

  it('ERC-1155: пустые данные закодированы смещением и нулевой длиной', () => {
    /* Последний аргумент — байты переменной длины: на его месте стоит
       смещение, а сами данные лежат в конце. */
    const encoded = encodeSafeTransfer1155(SENDER, RECIPIENT, 5n, 1n)

    expect(BigInt(`0x${encoded.slice(266, 330)}`)).toBe(160n)
    expect(BigInt(`0x${encoded.slice(330)}`)).toBe(0n)
  })
})

describe('Чтение ответов контракта', () => {
  it('адрес читается из младших двадцати байт', () => {
    const word = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, '0')}` as HexString

    expect(decodeAddress(word)).toBe(RECIPIENT)
  })

  it('слово с ненулевыми старшими байтами адресом не считается', () => {
    /* Выдать его за адрес значило бы показать владельцем предмета
       того, кого контракт не называл. */
    expect(() => decodeAddress(`0x${'f'.repeat(64)}` as HexString)).toThrow()
  })

  it('пустой ответ не считается адресом', () => {
    expect(() => decodeAddress('0x' as HexString)).toThrow()
  })

  it('ненулевое слово читается как истина', () => {
    expect(decodeBool(`0x${'0'.repeat(63)}1` as HexString)).toBe(true)
  })

  it('пустой ответ читается как ложь', () => {
    /* У ERC-165 это законный случай: старые контракты интерфейс
       не объявляют вовсе. */
    expect(decodeBool('0x' as HexString)).toBe(false)
  })
})
