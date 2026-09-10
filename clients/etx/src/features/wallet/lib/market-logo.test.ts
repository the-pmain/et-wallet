import { describe, expect, it } from 'vitest'

import { findMarketLogo } from './market-logo'

describe('findMarketLogo', () => {
  it('выдаёт знак из сборки по идентификатору CoinGecko', () => {
    expect(findMarketLogo('bitcoin')?.src).toBe('/logos/btc.svg')
    expect(findMarketLogo('ethereum')?.srcOnDark).toBe('/logos/eth-on-dark.svg')
  })

  it('не ходит за чужой картинкой неизвестной монеты', () => {
    expect(findMarketLogo('unknown-coin')).toBeNull()
  })
})
