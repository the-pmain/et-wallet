import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, listVerifiedTokens, toAddress } from '@/core'
import { findTokenLogo } from '@/features/wallet/lib/token-logo'

import { ADDABLE_ASSETS, networkNameForChain, remoteAssetKey } from './addable-assets'

describe('addable-assets', () => {
  it('держит нативную валюту и проверенные контракты каждой встроенной сети', () => {
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

  it('не повторяет одну и ту же пару сети и адреса', () => {
    const keys = ADDABLE_ASSETS.map((item) => item.id)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('даёт знак каждой позиции: меню не показывает монограмму вместо иконки', () => {
    for (const item of ADDABLE_ASSETS) {
      const address = item.token.address === null ? null : toAddress(item.token.address)

      expect(
        findTokenLogo(item.chainId, address),
        `${item.token.symbol} on ${item.chainName}`,
      ).not.toBeNull()
    }
  })

  it('собирает ключ без учёта регистра адреса', () => {
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

  it('подписывает известную сеть именем, неизвестную — номером', () => {
    expect(networkNameForChain('1')).toBe('Ethereum')
    expect(networkNameForChain('999999')).toBe('Chain 999999')
  })
})
