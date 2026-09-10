import {
  decodeAddress,
  decodeBool,
  encodeCallWithAddressAndUint,
  encodeCallWithUint,
  encodeUintWord,
} from '@/core/abi'
import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  ERC1155_BALANCE_OF_SELECTOR,
  OWNER_OF_SELECTOR,
  SAFE_TRANSFER_1155_SELECTOR,
  SAFE_TRANSFER_721_SELECTOR,
  SUPPORTS_INTERFACE_SELECTOR,
  encodeSafeTransfer1155,
  encodeSafeTransfer721,
  encodeSupportsInterface,
} from './abi'

const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Selectors match the standard ones', () => {
  /* The values are well known and published in the specs; here they
     are computed from the signature, and a match confirms the
     signature is written correctly. One wrong character would call
     a missing function and the contract would refuse with no clear
     reason. */
  it.each([
    ['ownerOf(uint256)', OWNER_OF_SELECTOR, '6352211e'],
    ['balanceOf(address,uint256)', ERC1155_BALANCE_OF_SELECTOR, '00fdd58e'],
    ['supportsInterface(bytes4)', SUPPORTS_INTERFACE_SELECTOR, '01ffc9a7'],
    ['safeTransferFrom(address,address,uint256)', SAFE_TRANSFER_721_SELECTOR, '42842e0e'],
    [
      'safeTransferFrom(address,address,uint256,uint256,bytes)',
      SAFE_TRANSFER_1155_SELECTOR,
      'f242432a',
    ],
  ])('%s', (_signature, actual: string, expected: string) => {
    expect(actual).toBe(expected)
  })
})

describe('Encoding arguments', () => {
  it('a number occupies exactly one word', () => {
    expect(encodeUintWord(1n)).toHaveLength(64)
  })

  it('rejects a number that does not fit in uint256', () => {
    /* Silently truncating the item id would call about a different
       item. */
    expect(() => encodeUintWord(1n << 256n)).toThrow(RangeError)
  })

  it('rejects a negative number', () => {
    expect(() => encodeUintWord(-1n)).toThrow(RangeError)
  })

  it('a call with a number is a selector plus a word', () => {
    expect(encodeCallWithUint(OWNER_OF_SELECTOR, 777n)).toBe(
      `0x${OWNER_OF_SELECTOR}${'0'.repeat(61)}309`,
    )
  })

  it('a call with an address and a number puts the address first', () => {
    const encoded = encodeCallWithAddressAndUint(ERC1155_BALANCE_OF_SELECTOR, RECIPIENT, 5n)

    expect(encoded.slice(10, 74)).toContain(RECIPIENT.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(5n)
  })

  it('an interface id is left-aligned', () => {
    /* `bytes4` is padded with zeroes on the RIGHT, unlike numbers
       and addresses. Mixed-up alignment asks about a different
       interface and gets a silent "not supported". */
    expect(encodeSupportsInterface('0x80ac58cd')).toBe(
      `0x${SUPPORTS_INTERFACE_SELECTOR}80ac58cd${'0'.repeat(56)}`,
    )
  })
})

describe('Encoding an item transfer', () => {
  it('ERC-721: sender, recipient and id in order', () => {
    const encoded = encodeSafeTransfer721(SENDER, RECIPIENT, 777n)

    expect(encoded.slice(0, 10)).toBe(`0x${SAFE_TRANSFER_721_SELECTOR}`)
    expect(encoded.slice(10, 74)).toContain(SENDER.slice(2).toLowerCase())
    expect(encoded.slice(74, 138)).toContain(RECIPIENT.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(138)}`)).toBe(777n)
  })

  it('ERC-721: the call data occupies exactly one hundred bytes', () => {
    /* Four selector bytes and three words of thirty-two. */
    expect(encodeSafeTransfer721(SENDER, RECIPIENT, 1n)).toHaveLength(2 + 8 + 64 * 3)
  })

  it('ERC-1155: the amount follows the id', () => {
    const encoded = encodeSafeTransfer1155(SENDER, RECIPIENT, 5n, 3n)

    expect(BigInt(`0x${encoded.slice(138, 202)}`)).toBe(5n)
    expect(BigInt(`0x${encoded.slice(202, 266)}`)).toBe(3n)
  })

  it('ERC-1155: empty data is encoded as an offset and zero length', () => {
    /* The last argument is variable-length bytes: an offset sits in
       its place, and the data itself is at the end. */
    const encoded = encodeSafeTransfer1155(SENDER, RECIPIENT, 5n, 1n)

    expect(BigInt(`0x${encoded.slice(266, 330)}`)).toBe(160n)
    expect(BigInt(`0x${encoded.slice(330)}`)).toBe(0n)
  })
})

describe('Reading contract replies', () => {
  it('an address is read from the low twenty bytes', () => {
    const word = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, '0')}` as HexString

    expect(decodeAddress(word)).toBe(RECIPIENT)
  })

  it('a word with non-zero high bytes is not treated as an address', () => {
    /* Treating it as an address would show as the item's owner
       someone the contract did not name. */
    expect(() => decodeAddress(`0x${'f'.repeat(64)}` as HexString)).toThrow()
  })

  it('an empty reply is not treated as an address', () => {
    expect(() => decodeAddress('0x' as HexString)).toThrow()
  })

  it('a non-zero word is read as true', () => {
    expect(decodeBool(`0x${'0'.repeat(63)}1` as HexString)).toBe(true)
  })

  it('an empty reply is read as false', () => {
    /* For ERC-165 this is lawful: old contracts do not declare the
       interface at all. */
    expect(decodeBool('0x' as HexString)).toBe(false)
  })
})
