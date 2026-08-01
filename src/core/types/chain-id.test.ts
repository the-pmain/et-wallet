import { describe, expect, it } from 'vitest'

import { InvalidArgumentError } from '@/core/errors'

import { MAX_CHAIN_ID, chainIdToHex, parseChainIdFromHex, toChainId } from './chain-id'

describe('toChainId', () => {
  it('принимает bigint, number и строку', () => {
    expect(toChainId(1n)).toBe(1n)
    expect(toChainId(137)).toBe(137n)
    expect(toChainId('42161')).toBe(42161n)
  })

  it('отвергает ноль и отрицательные значения', () => {
    expect(() => toChainId(0)).toThrow(InvalidArgumentError)
    expect(() => toChainId(-1)).toThrow(InvalidArgumentError)
  })

  it('отвергает значения выше допустимого предела', () => {
    expect(() => toChainId(MAX_CHAIN_ID + 1n)).toThrow(InvalidArgumentError)
  })

  it('отвергает нечисловые строки', () => {
    expect(() => toChainId('не число')).toThrow(InvalidArgumentError)
  })

  it('отвергает дробные значения', () => {
    expect(() => toChainId(1.5)).toThrow(InvalidArgumentError)
  })
})

describe('parseChainIdFromHex', () => {
  it('разбирает ответ узла', () => {
    expect(parseChainIdFromHex('0x1')).toBe(1n)
    expect(parseChainIdFromHex('0xa4b1')).toBe(42161n)
  })

  it('отвергает значения без префикса 0x', () => {
    expect(() => parseChainIdFromHex('1')).toThrow(InvalidArgumentError)
  })

  it('отвергает нестроковые значения', () => {
    expect(() => parseChainIdFromHex(1)).toThrow(InvalidArgumentError)
    expect(() => parseChainIdFromHex(null)).toThrow(InvalidArgumentError)
    expect(() => parseChainIdFromHex(undefined)).toThrow(InvalidArgumentError)
  })

  it('отвергает мусор в шестнадцатеричной части', () => {
    expect(() => parseChainIdFromHex('0xzz')).toThrow(InvalidArgumentError)
  })
})

describe('chainIdToHex', () => {
  it('преобразует в формат EIP-1193', () => {
    expect(chainIdToHex(toChainId(1))).toBe('0x1')
    expect(chainIdToHex(toChainId(137))).toBe('0x89')
    expect(chainIdToHex(toChainId(43114))).toBe('0xa86a')
  })

  it('обратим относительно parseChainIdFromHex', () => {
    const original = toChainId(8453)

    expect(parseChainIdFromHex(chainIdToHex(original))).toBe(original)
  })
})
