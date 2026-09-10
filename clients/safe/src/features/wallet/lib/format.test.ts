import { describe, expect, it } from 'vitest'

import { formatExactTokenAmount, formatTokenAmount, shortenAddress } from './format'

const ETH_DECIMALS = 18

describe('formatTokenAmount', () => {
  it('shows a whole value without a fractional part', () => {
    expect(formatTokenAmount(10n ** 18n, ETH_DECIMALS)).toBe('1')
  })

  it('shows zero as zero', () => {
    expect(formatTokenAmount(0n, ETH_DECIMALS)).toBe('0')
  })

  it('pads the fractional part with leading zeros', () => {
    /* 0.05 ETH is 5·10^16 wei. Without padding the remainder "5"
       would be read as 0.5 — ten times too much. */
    expect(formatTokenAmount(50_000_000_000_000_000n, ETH_DECIMALS)).toBe('0.05')
  })

  it('strips trailing insignificant zeros', () => {
    expect(formatTokenAmount(1_500_000_000_000_000_000n, ETH_DECIMALS)).toBe('1.5')
  })

  it('truncates instead of rounding up', () => {
    /* 1.9999999 ETH at six digits must show as 1.999999: rounding to
       2 would invite sending an amount that is not available. */
    expect(formatTokenAmount(1_999_999_900_000_000_000n, ETH_DECIMALS)).toBe('1.999999')
  })

  it('never shows a non-zero remainder as zero', () => {
    /* One wei is below display precision. A shown "0" would mean
       "no funds", which is false. */
    expect(formatTokenAmount(1n, ETH_DECIMALS)).toBe('<0.000001')
  })

  it('keeps the whole part when the remainder is too small', () => {
    expect(formatTokenAmount(10n ** 18n + 1n, ETH_DECIMALS)).toBe('<1.000001')
  })

  it('works with tokens that have a different decimal count', () => {
    expect(formatTokenAmount(1_500_000n, 6)).toBe('1.5')
  })

  it('works with a token that has no fractional part', () => {
    expect(formatTokenAmount(42n, 0)).toBe('42')
  })

  it('handles a negative value', () => {
    expect(formatTokenAmount(-(10n ** 18n), ETH_DECIMALS)).toBe('-1')
  })

  it('does not lose precision on amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const raw = 123_456_789_123_456_789_123_456_789n

    expect(formatTokenAmount(raw, ETH_DECIMALS)).toBe('123456789.123456')
  })
})

describe('formatExactTokenAmount', () => {
  it('shows whole token units without smallest units', () => {
    expect(formatExactTokenAmount(2n * 10n ** 18n, ETH_DECIMALS)).toBe('2')
  })

  it('keeps the fractional part in full', () => {
    expect(formatExactTokenAmount(1n, ETH_DECIMALS)).toBe('0.000000000000000001')
    expect(formatExactTokenAmount(1_500_000n, 6)).toBe('1.5')
  })

  it('shows zero as zero', () => {
    expect(formatExactTokenAmount(0n, ETH_DECIMALS)).toBe('0')
  })
})

describe('shortenAddress', () => {
  it('keeps EIP-55 checksum casing', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    expect(shortenAddress(address)).toBe('0x5aAe…1BeAed')
  })

  it('leaves a short string untouched', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234')
  })
})
