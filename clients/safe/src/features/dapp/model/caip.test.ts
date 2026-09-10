import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, MAX_CHAIN_ID, toAddress, toChainId } from '@/core'

import { parseCaip2, toCaip10, toCaip2 } from './caip'

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

describe('toCaip2', () => {
  it.each([
    [BUILT_IN_CHAIN_ID.Ethereum, 'eip155:1'],
    [BUILT_IN_CHAIN_ID.Polygon, 'eip155:137'],
    [BUILT_IN_CHAIN_ID.Arbitrum, 'eip155:42161'],
  ])('builds network identifier %s', (chainId, expected) => {
    expect(toCaip2(chainId)).toBe(expected)
  })
})

describe('toCaip10', () => {
  it('builds an account identifier', () => {
    expect(toCaip10(BUILT_IN_CHAIN_ID.Ethereum, OWNER)).toBe(`eip155:1:${OWNER}`)
  })

  it('preserves address case', () => {
    /* Case carries the EIP-55 checksum: lowercasing would strip
       the recipient's only typo protection. */
    expect(toCaip10(BUILT_IN_CHAIN_ID.Ethereum, OWNER)).toContain('0xd8dA6BF2')
  })
})

describe('parseCaip2', () => {
  it('reads the network back', () => {
    expect(parseCaip2('eip155:137')).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('is reversible for every built-in network', () => {
    for (const chainId of Object.values(BUILT_IN_CHAIN_ID)) {
      expect(parseCaip2(toCaip2(chainId))).toBe(chainId)
    }
  })

  it('reads the largest allowed identifier', () => {
    /* `ChainId` is `bigint`: the EIP-2294 limit (2^53−1) already
       exceeds a JSON-safe integer. */
    const large = toChainId(MAX_CHAIN_ID)

    expect(parseCaip2(toCaip2(large))).toBe(large)
  })

  it('rejects an identifier beyond the EIP-2294 limit', () => {
    /* No node serves such a network. Accepting it would sign a
       transaction for a chain that does not exist. */
    expect(parseCaip2(`eip155:${(MAX_CHAIN_ID + 1n).toString()}`)).toBeNull()
  })

  it.each([
    ['a foreign namespace', 'solana:mainnet'],
    ['no separator', 'eip155'],
    ['a non-numeric network', 'eip155:mainnet'],
    ['a negative network', 'eip155:-1'],
    ['hex notation', 'eip155:0x1'],
    ['an empty string', ''],
    ['a space instead of the number', 'eip155: 1'],
  ])('rejects %s', (_name, value) => {
    /* Substituting a default here would run a request on a network
       the app did not ask for. */
    expect(parseCaip2(value)).toBeNull()
  })
})
