import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  hexToBigInt,
  splitDataWords,
  topicToAddress,
} from './transfer-events'

const ADDRESS = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

describe('Event identifiers', () => {
  it('are computed, not taken from a constant', () => {
    /* The keccak256 of `Transfer(address,address,uint256)` is
       published in ERC-20 and matches on every EVM network. The
       check pins that exact value: one wrong character would yield
       empty history with no error at all. */
    expect(TRANSFER_TOPIC).toBe(
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    )
  })

  it('distinguish ERC-1155 events', () => {
    expect(TRANSFER_SINGLE_TOPIC).toBe(
      '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    )
    expect(TRANSFER_BATCH_TOPIC).toBe(
      '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
    )
  })

  it('are 32 bytes long', () => {
    for (const topic of [TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]) {
      expect(topic).toHaveLength(66)
    }
  })

  it('do not match each other', () => {
    const topics = new Set([TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC])

    expect(topics.size).toBe(3)
  })
})

describe('addressToTopic', () => {
  it('pads the address with zeros to 32 bytes', () => {
    const topic = addressToTopic(ADDRESS)

    expect(topic).toHaveLength(66)
    expect(topic.startsWith('0x000000000000000000000000')).toBe(true)
  })

  it('lowercases the address', () => {
    /* The node compares topics byte for byte: an EIP-55 writing
       would match no log. */
    expect(addressToTopic(ADDRESS)).toBe(`0x${ADDRESS.slice(2).toLowerCase().padStart(64, '0')}`)
  })
})

describe('topicToAddress', () => {
  it('recovers the address from the topic', () => {
    expect(topicToAddress(addressToTopic(ADDRESS)).toLowerCase()).toBe(ADDRESS.toLowerCase())
  })

  it('returns the address in EIP-55 form', () => {
    /* The topic stores the address in lowercase, but what leaves
       must be checksummed: without it the user has no way to notice
       a substitution. */
    expect(topicToAddress(addressToTopic(ADDRESS))).toBe(ADDRESS)
  })

  it('rejects a topic of the wrong length', () => {
    expect(() => topicToAddress('0x1234' as HexString)).toThrow()
  })
})

describe('hexToBigInt', () => {
  it('reads a hex value', () => {
    expect(hexToBigInt('0xff')).toBe(255n)
  })

  it('treats an empty value as zero', () => {
    /* Nodes return `0x` for empty data, and `BigInt('0x')`
       throws. */
    expect(hexToBigInt('0x')).toBe(0n)
    expect(hexToBigInt('')).toBe(0n)
  })

  it('does not lose precision on large amounts', () => {
    const raw = '0xffffffffffffffffffffffff'

    expect(hexToBigInt(raw)).toBe(79_228_162_514_264_337_593_543_950_335n)
  })
})

describe('splitDataWords', () => {
  it('splits data into 32-byte words', () => {
    const data = `0x${'1'.padStart(64, '0')}${'2'.padStart(64, '0')}` as HexString

    expect(splitDataWords(data)).toEqual([1n, 2n])
  })

  it('returns an empty list for empty data', () => {
    expect(splitDataWords('0x' as HexString)).toEqual([])
  })

  it('ignores an incomplete last word', () => {
    const data = `0x${'1'.padStart(64, '0')}abcd` as HexString

    expect(splitDataWords(data)).toEqual([1n])
  })
})
