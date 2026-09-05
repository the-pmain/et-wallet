import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, DEFAULT_CHAIN_ID } from './built-in'
import { assertValidExplorerUrl, assertValidRpcUrls } from './rpc-url'

/**
 * The network directory is data, not logic. Tests here guard against
 * typos the compiler will not catch: a repeated chainId, an unsecured
 * node address, a forgotten decimal count.
 */

describe('BUILT_IN_NETWORKS', () => {
  it('contains seven networks', () => {
    expect(BUILT_IN_NETWORKS).toHaveLength(7)
  })

  it('contains no repeated identifiers', () => {
    const chainIds = BUILT_IN_NETWORKS.map((network) => network.chainId)

    expect(new Set(chainIds).size).toBe(chainIds.length)
  })

  it('covers every declared identifier', () => {
    const declared = new Set(Object.values(BUILT_IN_CHAIN_ID))
    const present = new Set(BUILT_IN_NETWORKS.map((network) => network.chainId))

    expect(present).toEqual(declared)
  })

  it('marks every network as built-in and mainnet', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.isBuiltIn).toBe(true)
      expect(network.isTestnet).toBe(false)
    }
  })

  it('uses only secured RPC addresses', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(() => {
        assertValidRpcUrls(network.rpcUrls)
      }).not.toThrow()
    }
  })

  it('provides several nodes for each network', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.rpcUrls.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('contains no repeated RPC addresses inside a network', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(new Set(network.rpcUrls).size).toBe(network.rpcUrls.length)
    }
  })

  it('points the block explorer at https', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.blockExplorerUrls.length).toBeGreaterThanOrEqual(1)

      for (const url of network.blockExplorerUrls) {
        expect(() => {
          assertValidExplorerUrl(url)
        }).not.toThrow()
      }
    }
  })

  it('describes the native currency fully', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.nativeCurrency.name.length).toBeGreaterThan(0)
      expect(network.nativeCurrency.symbol.length).toBeGreaterThan(0)
      expect(network.nativeCurrency.decimals).toBe(18)
    }
  })

  it('contains the expected network identifiers', () => {
    expect(BUILT_IN_CHAIN_ID.Ethereum).toBe(1n)
    expect(BUILT_IN_CHAIN_ID.Optimism).toBe(10n)
    expect(BUILT_IN_CHAIN_ID.BnbChain).toBe(56n)
    expect(BUILT_IN_CHAIN_ID.Polygon).toBe(137n)
    expect(BUILT_IN_CHAIN_ID.Base).toBe(8453n)
    expect(BUILT_IN_CHAIN_ID.Arbitrum).toBe(42161n)
    expect(BUILT_IN_CHAIN_ID.Avalanche).toBe(43114n)
  })

  it('marks BNB Chain as a network without live EIP-1559', () => {
    const bnb = BUILT_IN_NETWORKS.find((network) => network.chainId === BUILT_IN_CHAIN_ID.BnbChain)

    expect(bnb?.supportsEip1559).toBe(false)
  })

  it('uses the POL symbol for Polygon', () => {
    const polygon = BUILT_IN_NETWORKS.find(
      (network) => network.chainId === BUILT_IN_CHAIN_ID.Polygon,
    )

    expect(polygon?.nativeCurrency.symbol).toBe('POL')
  })

  it('assigns Ethereum as the default network', () => {
    expect(DEFAULT_CHAIN_ID).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })
})
