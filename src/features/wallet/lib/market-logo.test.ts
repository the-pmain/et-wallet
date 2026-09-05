import { describe, expect, it } from 'vitest'

import { findMarketLogo } from './market-logo'

describe('findMarketLogo', () => {
  it('gives a bundled mark by CoinGecko id', () => {
    expect(findMarketLogo('bitcoin')?.src).toBe('/logos/btc.svg')
    expect(findMarketLogo('ethereum')?.srcOnDark).toBe('/logos/eth-on-dark.svg')
  })

  it('does not fetch a foreign image for an unknown coin', () => {
    expect(findMarketLogo('unknown-coin')).toBeNull()
  })
})
