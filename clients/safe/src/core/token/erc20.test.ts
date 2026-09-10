import { decodeUint, encodeCall, encodeCallWithAddress } from '@/core/abi'
import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  TRANSFER_SELECTOR,
  decodeString,
  decodeTransfer,
  encodeTransfer,
} from './erc20'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

function word(value: string): string {
  return value.padStart(64, '0')
}

function utf8(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('Function selectors', () => {
  it('are computed, not taken from a constant', () => {
    /* The values are published in ERC-20 and are the same in every
       implementation. One wrong character would call a missing
       function and the contract would refuse with no clear reason. */
    expect(DECIMALS_SELECTOR).toBe('313ce567')
    expect(SYMBOL_SELECTOR).toBe('95d89b41')
    expect(NAME_SELECTOR).toBe('06fdde03')
    expect(BALANCE_OF_SELECTOR).toBe('70a08231')
  })

  it('are four bytes long', () => {
    for (const value of [DECIMALS_SELECTOR, SYMBOL_SELECTOR, NAME_SELECTOR, BALANCE_OF_SELECTOR]) {
      expect(value).toHaveLength(8)
    }
  })
})

describe('encodeCallWithAddress', () => {
  it('pads the address to an ABI word', () => {
    const encoded = encodeCallWithAddress(BALANCE_OF_SELECTOR, OWNER)

    expect(encoded).toHaveLength(2 + 8 + 64)
    expect(encoded.startsWith(`0x${BALANCE_OF_SELECTOR}`)).toBe(true)
  })

  it('lowercases the address', () => {
    /* The contract compares bytes: an EIP-55 checksum spelling would
       be read as a different value. */
    expect(encodeCallWithAddress(BALANCE_OF_SELECTOR, OWNER)).toBe(
      `0x${BALANCE_OF_SELECTOR}${OWNER.slice(2).toLowerCase().padStart(64, '0')}`,
    )
  })

  it('encodes a no-argument call as the selector alone', () => {
    expect(encodeCall(DECIMALS_SELECTOR)).toBe(`0x${DECIMALS_SELECTOR}`)
  })
})

describe('decodeUint', () => {
  it('reads the number of decimal places', () => {
    expect(decodeUint(`0x${word('6')}` as HexString)).toBe(6n)
    expect(decodeUint(`0x${word('12')}` as HexString)).toBe(18n)
  })

  it('does not lose precision on large balances', () => {
    const raw = 'f'.repeat(64)

    expect(decodeUint(`0x${raw}` as HexString)).toBe(2n ** 256n - 1n)
  })

  it('rejects an empty reply', () => {
    /* An empty reply means the function is not in the contract:
       taking it as zero would show a zero balance instead of an
       error. */
    expect(() => decodeUint('0x' as HexString)).toThrow()
  })
})

describe('decodeString: variable-length string', () => {
  it('reads a token symbol', () => {
    const data = `0x${word('20')}${word('4')}${utf8('USDC').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('USDC')
  })

  it('reads a name with characters outside Latin', () => {
    const name = 'Test token テスト'
    const bytes = utf8(name)
    const data = `0x${word('20')}${word((bytes.length / 2).toString(16))}${bytes.padEnd(128, '0')}`

    expect(decodeString(data as HexString)).toBe(name)
  })

  it('reads the offset instead of assuming it', () => {
    /* The standard does not guarantee an offset of exactly 32 bytes.
       A hard assumption would break on a contract with another
       layout. */
    const data = `0x${word('40')}${word('0')}${word('3')}${utf8('ABC').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('ABC')
  })

  it('rejects a reply shorter than the declared offset', () => {
    const data = `0x${word('200')}${word('4')}`

    expect(() => decodeString(data as HexString)).toThrow()
  })
})

describe('decodeString: bytes32', () => {
  it("reads an old token's symbol", () => {
    /* Tokens issued before the final standard return `bytes32` padded
       with zeroes on the right. MKR is the best known. A decoder that
       only understands `string` would not add them at all. */
    const data = `0x${utf8('MKR').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('MKR')
  })

  it('trims the zero padding', () => {
    const data = `0x${utf8('DAI').padEnd(64, '0')}`

    expect(decodeString(data as HexString)).toBe('DAI')
  })

  it('reads a value that occupies the whole word', () => {
    const text = 'A'.repeat(32)
    const data = `0x${utf8(text)}`

    expect(decodeString(data as HexString)).toBe(text)
  })

  it('rejects an empty reply', () => {
    expect(() => decodeString('0x' as HexString)).toThrow()
  })
})

describe('Encoding a transfer', () => {
  /* Reference: a transfer call to 0xfB69…d359 for 1 000 000 units.
     Selector 0xa9059cbb is the well-known value, and the same one
     comes from keccak256('transfer(address,uint256)'). */
  const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

  it('the selector matches the standard one', () => {
    expect(TRANSFER_SELECTOR).toBe('a9059cbb')
  })

  it('builds the call from the selector and two words', () => {
    expect(encodeTransfer(RECIPIENT, 1_000_000n)).toBe(
      '0xa9059cbb' +
        '000000000000000000000000fb6916095ca1df60bb79ce92ce3ea74c37c5d359' +
        '00000000000000000000000000000000000000000000000000000000000f4240',
    )
  })

  it('lowercases the address', () => {
    /* The contract compares bytes. An EIP-55 checksum spelling would
       yield a different word. */
    expect(encodeTransfer(RECIPIENT, 1n)).toContain('fb6916095ca1df60bb79ce92ce3ea74c37c5d359')
  })

  it('the call data occupies exactly 68 bytes', () => {
    /* Four selector bytes and two words of 32. Extra bytes would mean
       a different call. */
    expect(encodeTransfer(RECIPIENT, 1n)).toHaveLength(2 + 8 + 64 * 2)
  })

  it('rejects an amount that does not fit in uint256', () => {
    /* A silently truncated value would send an amount other than the
       one the user confirmed. */
    expect(() => encodeTransfer(RECIPIENT, 1n << 256n)).toThrow(RangeError)
  })

  it('rejects a negative amount', () => {
    expect(() => encodeTransfer(RECIPIENT, -1n)).toThrow(RangeError)
  })
})

describe('Parsing a transfer', () => {
  const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

  it('reads the recipient and amount back', () => {
    const decoded = decodeTransfer(encodeTransfer(RECIPIENT, 123_456n))

    expect(decoded?.to.toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(decoded?.amount).toBe(123_456n)
  })

  it('does not treat empty data as a transfer', () => {
    expect(decodeTransfer('0x' as HexString)).toBeNull()
  })

  it('does not treat a foreign call as a transfer', () => {
    expect(decodeTransfer(encodeCallWithAddress(BALANCE_OF_SELECTOR, RECIPIENT))).toBeNull()
  })

  it('does not treat a call with extra data as a transfer', () => {
    /* The same selector with a third word is a different function.
       Reading a recipient from it would show a transfer in history
       that never happened. */
    expect(
      decodeTransfer(`${encodeTransfer(RECIPIENT, 1n)}${'0'.repeat(64)}` as HexString),
    ).toBeNull()
  })

  it('does not treat a word with non-zero high bytes as an address', () => {
    /* An address occupies the low twenty bytes. A word filled in full
       is not an address and must not be shown as one. */
    const forged = `0xa9059cbb${'f'.repeat(64)}${'0'.repeat(64)}` as HexString

    expect(decodeTransfer(forged)).toBeNull()
  })
})
