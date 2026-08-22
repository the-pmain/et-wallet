import { describe, expect, it } from 'vitest'

import {
  cryptoEquivalentFromUsdInput,
  tryParseUsdToMinimalUnits,
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

  it('shows crypto equivalent text', () => {
    expect(cryptoEquivalentFromUsdInput('6568.24', ETH, 3284.12)).toBe('≈ 2 ETH')
    expect(cryptoEquivalentFromUsdInput('9852.36', ETH, 3284.12)).toBe('≈ 3 ETH')
  })
})
