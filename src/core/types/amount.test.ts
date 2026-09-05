import { describe, expect, it } from 'vitest'

import { InvalidArgumentError } from '@/core/errors'

import { MAX_UINT256, toTokenUnits, toWei } from './amount'

describe('toWei', () => {
  it('accepts bigint, number, and string', () => {
    expect(toWei(1n)).toBe(1n)
    expect(toWei(1000)).toBe(1000n)
    expect(toWei('1000000000000000000')).toBe(1_000_000_000_000_000_000n)
  })

  it('accepts zero', () => {
    expect(toWei(0)).toBe(0n)
  })

  it('accepts the maximum representable in the EVM', () => {
    expect(toWei(MAX_UINT256)).toBe(MAX_UINT256)
  })

  it('rejects negative values', () => {
    /* Negative amounts do not exist in the EVM: the sign would
       become a huge positive number on encode. */
    expect(() => toWei(-1n)).toThrow(InvalidArgumentError)
    expect(() => toWei('-1')).toThrow(InvalidArgumentError)
  })

  it('rejects values beyond 2^256-1', () => {
    expect(() => toWei(MAX_UINT256 + 1n)).toThrow(InvalidArgumentError)
  })

  it('rejects fractional values', () => {
    /* Wei is indivisible. Rounding here would silently change the
       transfer amount. */
    expect(() => toWei(1.5)).toThrow(InvalidArgumentError)
  })

  it('rejects a number outside the safe range', () => {
    /* BigInt(2**53 + 1) silently yields an already-imprecise value —
       more dangerous than a fraction, because it is not visible. */
    expect(() => toWei(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidArgumentError)
  })

  it('rejects non-numeric strings', () => {
    expect(() => toWei('many')).toThrow(InvalidArgumentError)
  })

  it('rejects NaN and infinity', () => {
    expect(() => toWei(Number.NaN)).toThrow(InvalidArgumentError)
    expect(() => toWei(Number.POSITIVE_INFINITY)).toThrow(InvalidArgumentError)
  })

  it('keeps precision on values above 2^53', () => {
    const huge = '123456789012345678901234567890'

    expect(toWei(huge).toString()).toBe(huge)
  })
})

describe('toTokenUnits', () => {
  it('accepts the same values as toWei', () => {
    expect(toTokenUnits('1000000')).toBe(1_000_000n)
  })

  it('rejects negative values', () => {
    expect(() => toTokenUnits(-1n)).toThrow(InvalidArgumentError)
  })
})
