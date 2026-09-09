import { describe, expect, it } from 'vitest'

import { TOKEN_SYMBOLS, isKnownTokenSymbol } from './token-symbols.ts'

describe('TOKEN_SYMBOLS', () => {
  it('holds tickers from users.assets.tokens', () => {
    expect(TOKEN_SYMBOLS).toEqual(['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'WETH'])
  })

  it('accepts a known ticker case-insensitively', () => {
    expect(isKnownTokenSymbol('eth')).toBe(true)
    expect(isKnownTokenSymbol('USDC')).toBe(true)
    expect(isKnownTokenSymbol('btc')).toBe(false)
    expect(isKnownTokenSymbol('')).toBe(false)
  })
})
