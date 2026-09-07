import { describe, expect, it } from 'vitest'

import {
  cryptoEquivalentFromUsdInput,
  humanAmountFromMinimalUnits,
  tryParseUsdToMinimalUnits,
  formatStoredUsdAmount,
  usdAmountFromCryptoInput,
  usdEquivalentFromCryptoAmount,
  usdInputFromStoredBalance,
} from './asset-usd-input'

const ETH = {
  chainId: '1',
  standard: 'native' as const,
  address: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  balance: '2000000000000000000',
  isVerified: true,
}

describe('asset-usd-input', () => {
  it('converts stored wei balance to USD input', () => {
    expect(usdInputFromStoredBalance('2000000000000000000', 18, 3284.12)).toBe('6568.24')
  })

  it('converts USD input back to wei', () => {
    expect(tryParseUsdToMinimalUnits('9852.36', 3284.12, 18)).toBe(3000000000000000000n)
  })

  it('formats a human transfer amount from wei', () => {
    expect(humanAmountFromMinimalUnits(3000000000000000000n, 18)).toBe('3')
    expect(humanAmountFromMinimalUnits(1500000n, 6)).toBe('1.5')
  })

  it('formats a stored USD string for display', () => {
    expect(formatStoredUsdAmount('42347.3')).toBe('$42,347.30')
    expect(formatStoredUsdAmount('502.27')).toBe('$502.27')
    expect(formatStoredUsdAmount('')).toBeNull()
    expect(formatStoredUsdAmount(null)).toBeNull()
  })

  it('shows USD equivalent for a crypto amount', () => {
    expect(usdEquivalentFromCryptoAmount('0.15', 3284.12)).toBe('≈ $492.62')
    expect(usdAmountFromCryptoInput('0.15', 3284.12)).toBe('492.62')
    expect(usdEquivalentFromCryptoAmount('', 3284.12)).toBeNull()
  })

  it('shows crypto equivalent text', () => {
    expect(cryptoEquivalentFromUsdInput('6568.24', ETH, 3284.12)).toBe('≈ 2 ETH')
    expect(cryptoEquivalentFromUsdInput('9852.36', ETH, 3284.12)).toBe('≈ 3 ETH')
  })
})
