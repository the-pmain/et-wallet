import { describe, expect, it } from 'vitest'

import { InvalidArgumentError } from '@/core/errors'

import { MAX_CHAIN_ID, chainIdToHex, parseChainIdFromHex, toChainId } from './chain-id'

describe('toChainId', () => {
  it('accepts bigint, number, and string', () => {
    expect(toChainId(1n)).toBe(1n)
    expect(toChainId(137)).toBe(137n)
    expect(toChainId('42161')).toBe(42161n)
  })

  it('rejects zero and negative values', () => {
    expect(() => toChainId(0)).toThrow(InvalidArgumentError)
    expect(() => toChainId(-1)).toThrow(InvalidArgumentError)
  })

  it('rejects values above the allowed limit', () => {
    expect(() => toChainId(MAX_CHAIN_ID + 1n)).toThrow(InvalidArgumentError)
  })

  it('rejects non-numeric strings', () => {
    expect(() => toChainId('not-a-number')).toThrow(InvalidArgumentError)
  })

  it('rejects fractional values', () => {
    expect(() => toChainId(1.5)).toThrow(InvalidArgumentError)
  })
})

describe('parseChainIdFromHex', () => {
  it('parses a node response', () => {
    expect(parseChainIdFromHex('0x1')).toBe(1n)
    expect(parseChainIdFromHex('0xa4b1')).toBe(42161n)
  })

  it('rejects values without a 0x prefix', () => {
    expect(() => parseChainIdFromHex('1')).toThrow(InvalidArgumentError)
  })

  it('rejects non-string values', () => {
    expect(() => parseChainIdFromHex(1)).toThrow(InvalidArgumentError)
    expect(() => parseChainIdFromHex(null)).toThrow(InvalidArgumentError)
    expect(() => parseChainIdFromHex(undefined)).toThrow(InvalidArgumentError)
  })

  it('rejects garbage in the hex part', () => {
    expect(() => parseChainIdFromHex('0xzz')).toThrow(InvalidArgumentError)
  })
})

describe('chainIdToHex', () => {
  it('converts to EIP-1193 form', () => {
    expect(chainIdToHex(toChainId(1))).toBe('0x1')
    expect(chainIdToHex(toChainId(137))).toBe('0x89')
    expect(chainIdToHex(toChainId(43114))).toBe('0xa86a')
  })

  it('is reversible relative to parseChainIdFromHex', () => {
    const original = toChainId(8453)

    expect(parseChainIdFromHex(chainIdToHex(original))).toBe(original)
  })
})
