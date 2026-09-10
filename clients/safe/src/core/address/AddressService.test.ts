import { beforeEach, describe, expect, it } from 'vitest'

import { SecretBuffer } from '@/core/encryption'
import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPrivateKeyError,
  SecretBufferWipedError,
} from '@/core/errors'
import { EIP55_ADDRESSES } from '@/core/hdwallet/vectors'

import { DEAD_ADDRESS, ZERO_ADDRESS, toAddress } from './Address'
import { AddressService } from './AddressService'
import { PUBLIC_KEY_FORMAT } from './types'

/**
 * secp256k1 group order. A private key must lie in 1..n-1.
 * The value is fixed by SEC 2 and is given in the curve spec.
 */
const CURVE_ORDER_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Private key equal to one.
 *
 * The matching public key is the curve generator, and the address
 * is well-known and constantly cited in the documentation. That
 * makes it a usable reference for the whole chain
 * "private key -> public key -> keccak256 -> EIP-55".
 */
const PRIVATE_KEY_ONE = fromHex('0000000000000000000000000000000000000000000000000000000000000001')
const ADDRESS_OF_KEY_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
const PUBLIC_KEY_OF_ONE_COMPRESSED =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const PUBLIC_KEY_OF_ONE_UNCOMPRESSED =
  '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'

let service: AddressService

beforeEach(() => {
  service = new AddressService()
})

describe('AddressService: parse and checksum', () => {
  it.each(EIP55_ADDRESSES)('brings %s to canonical form', (address) => {
    expect(service.checksum(address.toLowerCase())).toBe(address)
  })

  it('accepts a lower-case address', () => {
    expect(service.parse('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('rejects a wrong checksum', () => {
    expect(() => service.parse('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toThrow(
      AddressChecksumMismatchError,
    )
  })

  it('rejects a string that is not an address', () => {
    expect(() => service.parse('0x123')).toThrow(InvalidAddressError)
  })

  it('confirms validity without throwing', () => {
    expect(service.isValid('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
    expect(service.isValid('garbage')).toBe(false)
  })

  it('compares addresses ignoring case', () => {
    expect(
      service.equals(
        '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'.toLowerCase(),
      ),
    ).toBe(true)
  })
})

describe('AddressService: binary form', () => {
  it('converts an address to 20 bytes', () => {
    const bytes = service.toBytes(toAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'))

    expect(bytes).toHaveLength(20)
    expect(toHex(bytes)).toBe('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
  })

  it('restores an address from bytes in checksum form', () => {
    const bytes = fromHex('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')

    expect(service.fromBytes(bytes)).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
  })

  it('is reversible for every official EIP-55 address', () => {
    for (const address of EIP55_ADDRESSES) {
      expect(service.fromBytes(service.toBytes(toAddress(address)))).toBe(address)
    }
  })

  it('rejects an array of the wrong length', () => {
    expect(() => service.fromBytes(new Uint8Array(19))).toThrow(InvalidAddressError)
    expect(() => service.fromBytes(new Uint8Array(21))).toThrow(InvalidAddressError)
  })
})

describe('AddressService: derivation from a private key', () => {
  /* Full chain secp256k1 -> Keccak-256 -> EIP-55 on a reference
     whose value is known independently of our implementation. */

  it('derives a public key in compressed form', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(toHex(service.getPublicKey(key))).toBe(PUBLIC_KEY_OF_ONE_COMPRESSED)
    } finally {
      key.wipe()
    }
  })

  it('derives a public key in uncompressed form', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(toHex(service.getPublicKey(key, PUBLIC_KEY_FORMAT.Uncompressed))).toBe(
        PUBLIC_KEY_OF_ONE_UNCOMPRESSED,
      )
    } finally {
      key.wipe()
    }
  })

  it('derives an address from a private key', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      expect(service.fromPrivateKey(key)).toBe(ADDRESS_OF_KEY_ONE)
    } finally {
      key.wipe()
    }
  })

  it('agrees with deriving an address from a public key', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      /* Two independent paths must meet. A mismatch would mean the
         wallet shows an address it cannot sign with. */
      expect(service.fromPrivateKey(key)).toBe(service.fromPublicKey(service.getPublicKey(key)))
    } finally {
      key.wipe()
    }
  })

  it('does not wipe the passed buffer: ownership stays with the caller', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)

    try {
      service.fromPrivateKey(key)

      expect(key.isWiped).toBe(false)
    } finally {
      key.wipe()
    }
  })

  it('refuses to work with a wiped buffer', () => {
    const key = SecretBuffer.copyOf(PRIVATE_KEY_ONE)
    key.wipe()

    expect(() => service.fromPrivateKey(key)).toThrow(SecretBufferWipedError)
  })
})

describe('AddressService: private-key check', () => {
  /* Length is not enough: only values 1..n-1 are allowed. A key
     outside the range does not define a point on the curve, and
     accepting it would yield an address different from the one
     shown to the user. */

  it('accepts a key in the allowed range', () => {
    expect(service.isValidPrivateKey(PRIVATE_KEY_ONE)).toBe(true)
  })

  it('rejects a zero key', () => {
    expect(service.isValidPrivateKey(new Uint8Array(32))).toBe(false)
  })

  it('rejects a key equal to the group order', () => {
    expect(service.isValidPrivateKey(fromHex(CURVE_ORDER_HEX))).toBe(false)
  })

  it('rejects a key larger than the group order', () => {
    expect(service.isValidPrivateKey(new Uint8Array(32).fill(0xff))).toBe(false)
  })

  it('accepts the largest allowed key n-1', () => {
    const maximum = fromHex(CURVE_ORDER_HEX)
    maximum.set([0x40], 31)

    expect(service.isValidPrivateKey(maximum)).toBe(true)
  })

  it('rejects a key of the wrong length', () => {
    expect(service.isValidPrivateKey(new Uint8Array(31))).toBe(false)
    expect(service.isValidPrivateKey(new Uint8Array(33))).toBe(false)
  })

  it('throws when deriving an address from an unusable key', () => {
    const key = SecretBuffer.allocate(32)

    try {
      expect(() => service.fromPrivateKey(key)).toThrow(InvalidPrivateKeyError)
    } finally {
      key.wipe()
    }
  })
})

describe('AddressService: unrecoverable addresses', () => {
  it('recognises the zero address', () => {
    expect(service.isZero(ZERO_ADDRESS)).toBe(true)
    expect(service.isZero('0x0000000000000000000000000000000000000000')).toBe(true)
  })

  it('does not treat an ordinary address as zero', () => {
    expect(service.isZero(ADDRESS_OF_KEY_ONE)).toBe(false)
  })

  it('recognises the conventional burn address', () => {
    expect(service.isBurn(DEAD_ADDRESS)).toBe(true)
  })

  it('treats the zero address as unrecoverable', () => {
    expect(service.isBurn(ZERO_ADDRESS)).toBe(true)
  })

  it('does not fire on an ordinary address', () => {
    /* A false hit would make the user cancel a legitimate transfer,
       so the heuristic is deliberately narrow. */
    expect(service.isBurn(ADDRESS_OF_KEY_ONE)).toBe(false)

    for (const address of EIP55_ADDRESSES) {
      expect(service.isBurn(address)).toBe(false)
    }
  })

  it('recognises burn addresses regardless of case', () => {
    expect(service.isBurn(DEAD_ADDRESS.toLowerCase())).toBe(true)
  })

  it('address constants pass the checksum check', () => {
    expect(() => toAddress(ZERO_ADDRESS)).not.toThrow()
    expect(() => toAddress(DEAD_ADDRESS)).not.toThrow()
  })
})

describe('AddressService: agreement with the pure functions', () => {
  /* The class must stay a thin wrapper. Growing its own
     address-computation logic is a direct threat: the two
     implementations will diverge. */

  it('parse matches toAddress', () => {
    for (const address of EIP55_ADDRESSES) {
      expect(service.parse(address)).toBe(toAddress(address))
    }
  })

  it('fromPublicKey matches a direct call', () => {
    const publicKey = fromHex(PUBLIC_KEY_OF_ONE_COMPRESSED)

    expect(service.fromPublicKey(publicKey)).toBe(ADDRESS_OF_KEY_ONE)
  })
})
