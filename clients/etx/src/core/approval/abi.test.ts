import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'

import {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  APPROVE_SELECTOR,
  IS_APPROVED_FOR_ALL_SELECTOR,
  SET_APPROVAL_FOR_ALL_SELECTOR,
  encodeAllowance,
  encodeRevokeAllowance,
  encodeRevokeApprovalForAll,
} from './abi'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Селекторы и темы совпадают со стандартными', () => {
  /* Значения общеизвестны и публикуются в спецификациях; здесь они
     вычисляются из подписей. Ошибка в подписи дала бы пустой список
     разрешений без единого сообщения об ошибке — то есть кошелёк молча
     сообщил бы владельцу, что он никому ничего не разрешал. */
  it.each([
    ['allowance(address,address)', ALLOWANCE_SELECTOR, 'dd62ed3e'],
    ['isApprovedForAll(address,address)', IS_APPROVED_FOR_ALL_SELECTOR, 'e985e9c5'],
    ['approve(address,uint256)', APPROVE_SELECTOR, '095ea7b3'],
    ['setApprovalForAll(address,bool)', SET_APPROVAL_FOR_ALL_SELECTOR, 'a22cb465'],
  ])('%s', (_signature, actual: string, expected: string) => {
    expect(actual).toBe(expected)
  })

  it('тема Approval', () => {
    expect(APPROVAL_TOPIC).toBe(
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    )
  })

  it('тема ApprovalForAll', () => {
    expect(APPROVAL_FOR_ALL_TOPIC).toBe(
      '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
    )
  })
})

describe('Кодирование чтения разрешения', () => {
  it('владелец идёт первым, получатель разрешения вторым', () => {
    /* Перепутать их значит прочитать чужое разрешение и показать
       владельцу, что он ничего не выдавал. */
    const encoded = encodeAllowance(ALLOWANCE_SELECTOR, OWNER, SPENDER)

    expect(encoded.slice(10, 74)).toContain(OWNER.slice(2).toLowerCase())
    expect(encoded.slice(74)).toContain(SPENDER.slice(2).toLowerCase())
  })
})

describe('Кодирование отзыва', () => {
  it('у токена отзыв — это выдача нуля', () => {
    /* Отдельной функции «отозвать» в стандарте нет: разрешение
       перезаписывается значением. */
    const encoded = encodeRevokeAllowance(SPENDER)

    expect(encoded.slice(0, 10)).toBe(`0x${APPROVE_SELECTOR}`)
    expect(encoded.slice(10, 74)).toContain(SPENDER.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(0n)
  })

  it('у коллекции отзыв — снятие признака', () => {
    const encoded = encodeRevokeApprovalForAll(SPENDER)

    expect(encoded.slice(0, 10)).toBe(`0x${SET_APPROVAL_FOR_ALL_SELECTOR}`)
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(0n)
  })

  it('данные отзыва занимают ровно 68 байт', () => {
    expect(encodeRevokeAllowance(SPENDER)).toHaveLength(2 + 8 + 64 * 2)
    expect(encodeRevokeApprovalForAll(SPENDER)).toHaveLength(2 + 8 + 64 * 2)
  })
})
