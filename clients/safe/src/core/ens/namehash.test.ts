import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'

import { namehash, reverseNode } from './namehash'

/**
 * Reference values from the EIP-137 text.
 *
 * The standard gives them as checks for a namehash implementation.
 * These are the only constants here written as a string: everything
 * else is computed. Their correctness was confirmed by a live call
 * to the ENS registry — `resolver(namehash('vitalik.eth'))` returns
 * a live resolver, and that resolver yields an address whose reverse
 * lookup returns the same name.
 */
const VECTORS: readonly { name: string; node: string }[] = [
  { name: '', node: `0x${'0'.repeat(64)}` },
  { name: 'eth', node: '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae' },
]

describe('namehash', () => {
  it.each(VECTORS)('matches the EIP-137 reference for "$name"', ({ name, node }) => {
    expect(namehash(name)).toBe(node)
  })

  it('distinguishes names that differ in case', () => {
    /* Normalisation is a separate function's job. The hash must
       stay byte-sensitive: hiding a case difference here would
       also hide the difference between a Latin and a Cyrillic letter. */
    expect(namehash('Vitalik.eth')).not.toBe(namehash('vitalik.eth'))
  })

  it('a nested name does not match its parent', () => {
    expect(namehash('a.eth')).not.toBe(namehash('eth'))
  })

  it('label order matters', () => {
    expect(namehash('a.b')).not.toBe(namehash('b.a'))
  })
})

describe('reverseNode', () => {
  it('does not depend on address case', () => {
    /* EIP-181 requires lowercase. An EIP-55 writing would yield
       a different node — and "no reverse record" for an address
       that has one. */
    const checksummed = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(reverseNode(checksummed)).toBe(
      namehash('d8da6bf26964af9d7eed9e03e53415d37aa96045.addr.reverse'),
    )
  })

  it('different addresses yield different nodes', () => {
    const first = toAddress(`0x${'11'.repeat(20)}`)
    const second = toAddress(`0x${'22'.repeat(20)}`)

    expect(reverseNode(first)).not.toBe(reverseNode(second))
  })
})
