import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toAddress, toChainId } from '@/core'

import { findTokenLogo } from './token-logo'

/** Real USDC on Ethereum — a built-in registry entry. */
const REAL_USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Arbitrary address: anyone can deploy such a contract. */
const FAKE = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('findTokenLogo: a mark is granted only to a verified token', () => {
  it('gives the mark to real USDC', () => {
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, REAL_USDC)?.src).toBe('/logos/usdc.svg')
  })

  it('does NOT give the mark to a fake with the same ticker', () => {
    /* The main check of this module. Anyone can mint a "USDC" ticker
       almost for free. A mark keyed by ticker would make the fake
       look real; a mark keyed by address distinguishes it. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, FAKE)).toBeNull()
  })

  it('does NOT give the mark to the same address on another chain', () => {
    /* One address on different chains is different contracts. The
       registry is keyed by (chain, address), and the mark follows. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.BnbChain, REAL_USDC)).toBeNull()
  })

  it('gives the native-currency mark by chain', () => {
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, null)?.src).toBe('/logos/eth.svg')
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.BnbChain, null)?.src).toBe('/logos/bnb.svg')

    /* L2 native currency is ether, so the mark is ether's: that is
       what they pay gas with, not a shortcut. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Base, null)?.src).toBe('/logos/eth.svg')
  })

  it('stays silent on an unknown chain instead of guessing', () => {
    expect(findTokenLogo(toChainId(9999n), null)).toBeNull()
    expect(findTokenLogo(null, REAL_USDC)).toBeNull()
  })

  it('ether has a dark-theme variant', () => {
    /* The official diamond is greys from `#141414` and vanishes on a
       dark background. Other marks do not, so they get no extra file. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, null)?.srcOnDark).toBe(
      '/logos/eth-on-dark.svg',
    )
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, REAL_USDC)?.srcOnDark).toBeNull()
  })

  it('a wrapped asset wears the underlying mark', () => {
    /* WETH is ether in an ERC-20 wrap, 1:1. The wrap has no mark of
       its own, and inventing one is pointless. */
    const weth = toAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')

    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, weth)?.src).toBe('/logos/eth.svg')
  })

  it('the Tether bridge on Arbitrum gets the same mark as USDT', () => {
    /* The contract answers with `USD₮0` (typographic tenge). It is
       still Tether; the mark must match or the add-token menu row
       would have no icon. */
    const usdT0 = toAddress('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9')

    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Arbitrum, usdT0)?.src).toBe('/logos/usdt.svg')
  })
})
