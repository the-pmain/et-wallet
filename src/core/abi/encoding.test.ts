import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  MAX_UINT256,
  WORD_LENGTH,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeAddressWord,
  encodeCallWithTwoAddresses,
  encodeUintWord,
  eventTopic,
  functionSelector,
  readAddressWord,
} from './encoding'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Selectors and topics', () => {
  it('the selector matches the standard value', () => {
    /* Well-known value: `transfer(address,uint256)` yields `a9059cbb`.
       The computation must produce the same. */
    expect(functionSelector('transfer(address,uint256)')).toBe('a9059cbb')
  })

  it('an event topic is longer than a selector', () => {
    /* An event occupies all thirty-two bytes, a function the first
       four. Mixing them up means searching the logs for something
       that is not there and getting an empty list with no error. */
    const topic = eventTopic('Transfer(address,address,uint256)')

    expect(topic).toHaveLength(2 + WORD_LENGTH)
    expect(topic.slice(2, 10)).toBe(functionSelector('Transfer(address,address,uint256)'))
  })
})

describe('Encoding words', () => {
  it('an address is right-aligned and forced to lower case', () => {
    /* The contract compares bytes: an EIP-55 checksum spelling would
       be read as a different value. */
    const word = encodeAddressWord(OWNER)

    expect(word).toHaveLength(WORD_LENGTH)
    expect(word.slice(0, 24)).toBe('0'.repeat(24))
    expect(word.slice(24)).toBe(OWNER.slice(2).toLowerCase())
  })

  it('a number is right-aligned', () => {
    expect(encodeUintWord(1n)).toBe('1'.padStart(WORD_LENGTH, '0'))
  })

  it('a negative number is rejected', () => {
    expect(() => encodeUintWord(-1n)).toThrow(RangeError)
  })

  it('a number beyond uint256 is rejected', () => {
    /* A silently truncated value would produce a call with a
       different amount or about a different item. */
    expect(() => encodeUintWord(MAX_UINT256 + 1n)).toThrow(RangeError)
  })

  it('two addresses keep the declared order', () => {
    const encoded = encodeCallWithTwoAddresses('dd62ed3e', OWNER, SPENDER)

    expect(encoded.slice(10, 74)).toContain(OWNER.slice(2).toLowerCase())
    expect(encoded.slice(74)).toContain(SPENDER.slice(2).toLowerCase())
  })
})

describe('Reading an address from a word', () => {
  it('a correctly aligned word is read', () => {
    expect(readAddressWord(encodeAddressWord(OWNER))?.toLowerCase()).toBe(OWNER.toLowerCase())
  })

  it('a word with non-zero high bytes is not an address', () => {
    /* THIS IS A SAFETY CHECK. Reading such a word as an address
       would show, on the confirmation screen, a recipient who is
       not in the call. */
    expect(readAddressWord('f'.repeat(WORD_LENGTH))).toBeNull()
  })

  it('a word of the wrong length is rejected', () => {
    expect(readAddressWord('00ff')).toBeNull()
  })

  it('the address is returned with a checksum', () => {
    /* Shown in lower case, it takes away the user's only protection
       against a typo when they compare. */
    expect(readAddressWord(encodeAddressWord(OWNER))).toBe(OWNER)
  })
})

describe('Reading contract responses', () => {
  it('a number is read from the first word', () => {
    expect(decodeUint(`0x${encodeUintWord(42n)}` as HexString)).toBe(42n)
  })

  it('an empty response for a number is an error', () => {
    /* An empty response means the function is missing. Substituting
       zero would present a missing function as a zero value. */
    expect(() => decodeUint('0x' as HexString)).toThrow()
  })

  it('an empty response for a boolean means no', () => {
    /* For ERC-165 this is a legal case: old contracts do not
       declare the interface. */
    expect(decodeBool('0x' as HexString)).toBe(false)
  })

  it('a non-zero word means yes', () => {
    expect(decodeBool(`0x${encodeUintWord(1n)}` as HexString)).toBe(true)
  })

  it('an address is read from the response', () => {
    expect(decodeAddress(`0x${encodeAddressWord(OWNER)}` as HexString)).toBe(OWNER)
  })

  it('a response shorter than a word is rejected', () => {
    expect(() => decodeAddress('0x00ff' as HexString)).toThrow()
  })

  it('a filled word is not accepted as an address', () => {
    expect(() => decodeAddress(`0x${'f'.repeat(WORD_LENGTH)}` as HexString)).toThrow()
  })
})
