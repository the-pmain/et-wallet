import { toAddress, toChainId } from '@/core'
import { describe, expect, it } from 'vitest'

import { MarketCatalog } from './MarketCatalog'

const ETH_USD = 3284.12
const CHAIN = toChainId(1)
const OP = toChainId(10)
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const OP_USDC = toAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85')

function ethereumCoin(price = ETH_USD) {
  return {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    rank: 2,
    priceUsd: price,
    change1hPercent: 0.1,
    change24hPercent: 1.84,
    change7dPercent: 4.2,
    volume24hUsd: 1,
    marketCapUsd: 2,
    sparkline7d: null,
  }
}

describe('MarketCatalog', () => {
  it('hits the source once and gives the rate to every wallet', async () => {
    let calls = 0
    const catalog = new MarketCatalog({
      loadMarkets: async () => {
        calls += 1
        return [ethereumCoin()]
      },
    })

    await Promise.all([catalog.ensureLoaded(), catalog.ensureLoaded()])
    await catalog.ensureLoaded()

    expect(calls).toBe(1)

    const mainnet = catalog.quoteForRef({ chainId: CHAIN, address: null })
    const optimism = catalog.quoteForRef({ chainId: OP, address: null })

    expect(mainnet?.price).toBe(ETH_USD)
    expect(optimism?.price).toBe(ETH_USD)
  })

  it('values a known ERC-20 from the market snapshot, without a second request', async () => {
    const catalog = new MarketCatalog({
      loadMarkets: async () => [
        ethereumCoin(),
        {
          id: 'usd-coin',
          symbol: 'USDC',
          name: 'USD Coin',
          rank: 7,
          priceUsd: 1,
          change1hPercent: 0,
          change24hPercent: 0,
          change7dPercent: 0,
          volume24hUsd: 1,
          marketCapUsd: 2,
          sparkline7d: null,
        },
      ],
    })

    await catalog.ensureLoaded()

    expect(catalog.quoteForRef({ chainId: CHAIN, address: USDC })?.price).toBe(1)
    expect(catalog.quoteForRef({ chainId: OP, address: OP_USDC })?.price).toBe(1)
    expect(catalog.coinForAsset({ chainId: CHAIN, address: null })?.id).toBe('ethereum')
  })

  it('on CoinGecko failure substitutes the ether rate from a fallback source', async () => {
    const catalog = new MarketCatalog({
      loadMarkets: async () => {
        throw new Error('429')
      },
      loadEthUsd: async () => 2500,
    })

    await catalog.ensureLoaded()

    expect(catalog.status).toBe('ready')
    expect(catalog.quoteForRef({ chainId: CHAIN, address: null })?.price).toBe(2500)
  })
})
