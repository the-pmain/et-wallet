import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, listVerifiedTokens, toAddress } from '@/core'
import { findTokenLogo } from '@/features/wallet/lib/token-logo'

import { ADDABLE_ASSETS, addableAssetBySymbol, networkNameForChain, remoteAssetKey } from './addable-assets'

describe('addable-assets', () => {
  it('holds native currency and verified contracts of each built-in network', () => {
    const expected =
      BUILT_IN_NETWORKS.length +
      BUILT_IN_NETWORKS.reduce(
        (count, network) => count + listVerifiedTokens(network.chainId).length,
        0,
      )

    expect(ADDABLE_ASSETS).toHaveLength(expected)
    expect(
      ADDABLE_ASSETS.some(
        (item) =>
          item.token.symbol === 'ETH' &&
          item.token.standard === 'native' &&
          item.chainId === BUILT_IN_CHAIN_ID.Ethereum,
      ),
    ).toBe(true)
    expect(
      ADDABLE_ASSETS.some((item) => item.token.symbol === 'USDC' && item.token.address !== null),
    ).toBe(true)
  })

  it('does not repeat the same network-and-address pair', () => {
    const keys = ADDABLE_ASSETS.map((item) => item.id)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every position a mark: the menu does not show a monogram instead of an icon', () => {
    for (const item of ADDABLE_ASSETS) {
      const address = item.token.address === null ? null : toAddress(item.token.address)

      expect(
        findTokenLogo(item.chainId, address),
        `${item.token.symbol} on ${item.chainName}`,
      ).not.toBeNull()
    }
  })

  it('builds a key without regard to address case', () => {
    expect(
      remoteAssetKey({
        chainId: '1',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
    ).toBe(
      remoteAssetKey({
        chainId: '1',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      }),
    )
    expect(remoteAssetKey({ chainId: '1', address: null })).toBe('1:native')
  })

  it('labels a known network by name and an unknown one by number', () => {
    expect(networkNameForChain('1')).toBe('Ethereum')
    expect(networkNameForChain('999999')).toBe('Chain 999999')
  })

  it('finds an asset by sendings ticker, preferring Ethereum', () => {
    const eth = addableAssetBySymbol('eth')

    expect(eth?.token.symbol).toBe('ETH')
    expect(eth?.token.name).toBe('Ether')
    expect(eth?.chainName).toBe('Ethereum')
    expect(addableAssetBySymbol('USDC')?.token.symbol).toBe('USDC')
    expect(addableAssetBySymbol(null)).toBeNull()
  })
})
