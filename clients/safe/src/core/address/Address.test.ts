import { describe, expect, it } from 'vitest'

import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPublicKeyError,
} from '@/core/errors'
import { EIP55_ADDRESSES } from '@/core/hdwallet/vectors'

import {
  areAddressesEqual,
  isValidAddress,
  publicKeyToAddress,
  toAddress,
  toChecksumAddress,
} from './Address'

describe('toChecksumAddress: official EIP-55 examples', () => {
  it.each(EIP55_ADDRESSES)('brings %s to canonical form', (address) => {
    expect(toChecksumAddress(address.toLowerCase())).toBe(address)
  })

  it('gives the same result for an upper-case input', () => {
    const [first] = EIP55_ADDRESSES

    expect(toChecksumAddress((first as string).toUpperCase().replace('0X', '0x'))).toBe(first)
  })

  it('is idempotent', () => {
    const [first] = EIP55_ADDRESSES

    expect(toChecksumAddress(toChecksumAddress(first as string))).toBe(first)
  })
})

describe('toAddress: format check', () => {
  it('accepts a lower-case address', () => {
    expect(toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('accepts an upper-case address', () => {
    expect(toAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('accepts a correct checksummed address', () => {
    const [first] = EIP55_ADDRESSES

    expect(toAddress(first as string)).toBe(first)
  })

  it('rejects a string without a 0x prefix', () => {
    expect(() => toAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toThrow(InvalidAddressError)
  })

  it('rejects an address that is too short', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea')).toThrow(InvalidAddressError)
  })

  it('rejects an address that is too long', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedff')).toThrow(
      InvalidAddressError,
    )
  })

  it('rejects illegal characters', () => {
    expect(() => toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaez')).toThrow(
      InvalidAddressError,
    )
  })

  it('rejects an empty string', () => {
    expect(() => toAddress('')).toThrow(InvalidAddressError)
  })
})

describe('toAddress: the checksum catches typos', () => {
  /* Key behaviour of the whole module. An EVM address has no checksum
     of its own, so a typo yields another syntactically valid address
     to which nobody has a private key. Funds sent there are lost
     for good. */

  it('rejects mixed case with a wrong checksum', () => {
    expect(() => toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('does not silently fix a wrong checksum', () => {
    /* Bringing such an address to the right case would strip EIP-55
       of its only purpose: the user would get a "fixed" address with
       a typo in the characters themselves. */
    expect(() => toAddress('0xD1220a0cf47c7B9Be7A2E6BA89F429762e7b9aDb')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('detects a one-character swap in a checksummed address', () => {
    const tampered = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee'

    expect(() => toAddress(tampered)).toThrow(AddressChecksumMismatchError)
  })
})

describe('isValidAddress', () => {
  it('confirms a correct address', () => {
    expect(isValidAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
  })

  it('confirms a lower-case address', () => {
    expect(isValidAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
  })

  it('rejects a wrong checksum', () => {
    expect(isValidAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isValidAddress('not-an-address')).toBe(false)
  })
})

describe('areAddressesEqual', () => {
  it('compares ignoring case', () => {
    expect(
      areAddressesEqual(
        '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
      ),
    ).toBe(true)
  })

  it('distinguishes different addresses', () => {
    const [first, second] = EIP55_ADDRESSES

    expect(areAddressesEqual(first as string, second as string)).toBe(false)
  })
})

describe('publicKeyToAddress', () => {
  /* The secp256k1 generator-point public key is a well-known value,
     and the address of private key 0x01 is constantly cited in the
     documentation. */
  const GENERATOR_COMPRESSED = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  const GENERATOR_UNCOMPRESSED =
    '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
  const EXPECTED_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'

  function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    }

    return bytes
  }

  it('derives an address from a compressed key', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_COMPRESSED))).toBe(EXPECTED_ADDRESS)
  })

  it('derives an address from an uncompressed key', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_UNCOMPRESSED))).toBe(EXPECTED_ADDRESS)
  })

  it('derives an address from a key without a prefix', () => {
    expect(publicKeyToAddress(fromHex(GENERATOR_UNCOMPRESSED).slice(1))).toBe(EXPECTED_ADDRESS)
  })

  it('returns the address in EIP-55 checksum form', () => {
    const address = publicKeyToAddress(fromHex(GENERATOR_COMPRESSED))

    expect(address).not.toBe(address.toLowerCase())
    expect(() => toAddress(address)).not.toThrow()
  })

  it('rejects a key of an illegal length', () => {
    expect(() => publicKeyToAddress(new Uint8Array(32))).toThrow(InvalidPublicKeyError)
  })

  it('rejects an uncompressed key without the 0x04 byte', () => {
    const wrong = fromHex(GENERATOR_UNCOMPRESSED)
    wrong[0] = 0x05

    expect(() => publicKeyToAddress(wrong)).toThrow(InvalidPublicKeyError)
  })

  it('rejects a point off the curve', () => {
    const invalid = fromHex(GENERATOR_COMPRESSED)
    /* Corrupt the X coordinate: Y cannot be recovered for such a
       point, so the key must be rejected, not turned into an
       address to which no private key exists. */
    invalid.set([(invalid[32] as number) ^ 0xff], 32)

    expect(() => publicKeyToAddress(invalid)).toThrow(InvalidPublicKeyError)
  })
})
