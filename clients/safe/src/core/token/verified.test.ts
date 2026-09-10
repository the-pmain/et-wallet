import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from '@/core/network'

import { findVerifiedToken, isVerifiedToken, listVerifiedTokens } from './verified'

const USDC_ETHEREUM = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const UNKNOWN = toAddress('0x1111111111111111111111111111111111111111')

describe('Lookup in the list', () => {
  it('finds a known contract', () => {
    const token = findVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, USDC_ETHEREUM)

    expect(token?.symbol).toBe('USDC')
    expect(token?.decimals).toBe(6)
  })

  it('does not distinguish address case', () => {
    /* The address arrives both with a checksum and without, and the
       contract is distinguished by bytes, not spelling. */
    expect(
      isVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, toAddress(USDC_ETHEREUM.toLowerCase())),
    ).toBe(true)
  })

  it('the same address on another network is not treated as verified', () => {
    /* The same address on different networks is different contracts.
       A mark carried across networks would vouch for foreign code. */
    expect(isVerifiedToken(BUILT_IN_CHAIN_ID.Polygon, USDC_ETHEREUM)).toBe(false)
  })

  it('an unknown address is not found', () => {
    expect(findVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, UNKNOWN)).toBeNull()
  })
})

describe('List contents', () => {
  it('every built-in network contains at least one verified contract', () => {
    /* A network with no verified contracts leaves the owner alone
       with a manual address check. */
    for (const network of BUILT_IN_NETWORKS) {
      expect(listVerifiedTokens(network.chainId).length).toBeGreaterThan(0)
    }
  })

  it('every record belongs to a built-in network', () => {
    const known = new Set(BUILT_IN_NETWORKS.map((network) => network.chainId))

    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(known.has(token.chainId)).toBe(true)
      }
    }
  })

  it('addresses do not repeat inside a network', () => {
    for (const network of BUILT_IN_NETWORKS) {
      const addresses = listVerifiedTokens(network.chainId).map((token) =>
        token.address.toLowerCase(),
      )

      expect(new Set(addresses).size).toBe(addresses.length)
    }
  })

  it('addresses are written with a checksum', () => {
    /* A record without a checksum hides a typo when reading the
       code — and the list exists so that the addresses can be
       trusted. */
    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(token.address).toBe(toAddress(token.address))
      }
    }
  })

  it('decimals are set and plausible', () => {
    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(Number.isInteger(token.decimals)).toBe(true)
        expect(token.decimals).toBeGreaterThanOrEqual(0)
        expect(token.decimals).toBeLessThanOrEqual(18)
      }
    }
  })
})

describe('Measured values, not memory', () => {
  it('BNB Chain stablecoins have eighteen decimals', () => {
    /* A live check: unlike Ethereum, where USDT has six decimals,
       bridged versions on BNB Chain declare eighteen. An error here
       would distort the amount by a trillion. */
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.BnbChain,
      toAddress('0x55d398326f99059fF775485246999027B3197955'),
    )

    expect(usdt?.decimals).toBe(18)
  })

  it('the Tether bridge on Polygon answers with symbol USDT0', () => {
    /* The symbol changed with the move to USDT0. A remembered "USDT"
       would disagree with the contract, and the check would fail
       exactly where it is needed. */
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.Polygon,
      toAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    )

    expect(usdt?.symbol).toBe('USDT0')
  })

  it('on Avalanche the symbol is written with a lowercase letter', () => {
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.Avalanche,
      toAddress('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
    )

    expect(usdt?.symbol).toBe('USDt')
  })
})
