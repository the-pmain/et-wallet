import { describe, expect, it } from 'vitest'

import { parseAmount } from './amount-input'

describe('parseAmount', () => {
  it('converts a whole value into smallest units', () => {
    expect(parseAmount('1', 18)).toBe(10n ** 18n)
  })

  it('does not lose precision on fractional amounts', () => {
    /* `Number('0.1') * 1e18` is 100000000000000001 — one unit more
       than asked. The user would confirm one amount and sign another. */
    expect(parseAmount('0.1', 18)).toBe(100_000_000_000_000_000n)
  })

  it('respects the token decimal count', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n)
  })

  it('accepts a comma as the separator', () => {
    expect(parseAmount('0,25', 18)).toBe(250_000_000_000_000_000n)
  })

  it('accepts a record without a whole part', () => {
    expect(parseAmount('.5', 18)).toBe(500_000_000_000_000_000n)
  })

  it('rejects extra fractional digits', () => {
    /* Rounding would send an amount different from what was typed. */
    expect(() => parseAmount('1.1234567', 6)).toThrow(/decimal places/)
  })

  it('rejects zero', () => {
    expect(() => parseAmount('0', 18)).toThrow(/greater than zero/)
    expect(() => parseAmount('0.0', 18)).toThrow(/greater than zero/)
  })

  it('accepts zero when it is explicitly allowed', () => {
    expect(parseAmount('0', 18, { allowZero: true })).toBe(0n)
    expect(parseAmount('0.0', 6, { allowZero: true })).toBe(0n)
  })

  it('rejects an empty string', () => {
    expect(() => parseAmount('   ', 18)).toThrow(/Enter an amount/)
  })

  it('rejects text and negative values', () => {
    expect(() => parseAmount('lots', 18)).toThrow()
    expect(() => parseAmount('-1', 18)).toThrow()
    expect(() => parseAmount('1e18', 18)).toThrow()
  })

  it('works with a token that has no fractional part', () => {
    expect(parseAmount('42', 0)).toBe(42n)
    expect(() => parseAmount('42.5', 0)).toThrow()
  })

  it('does not drop digits on very large amounts', () => {
    expect(parseAmount('123456789.123456789123456789', 18)).toBe(
      123_456_789_123_456_789_123_456_789n,
    )
  })
})
