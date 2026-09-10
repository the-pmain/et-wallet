import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { toAddress } from '@/core/address'
import type { Address, HexString } from '@/core/types'

/**
 * ABI encoding: the parts that belong to no single standard.
 *
 * WHY A SEPARATE MODULE. Word length, address padding, and reading a
 * contract response are the same for ERC-20, ERC-721, ERC-1155, and
 * any other contract: they are encoding rules, not properties of a
 * standard. Spread across the token, item, and approval modules they
 * existed in three copies — and the copies had already started to
 * diverge.
 *
 * WHY THAT IS DANGEROUS HERE. The check "the high twelve bytes of the
 * word are zero" lived in two places and decided which address to
 * show on the confirmation screen. Divergent copies would mean the
 * wallet rejects a forged word in one place and accepts it in another,
 * showing the owner a recipient who is not in the call.
 *
 * WHAT DOES NOT BELONG HERE. Selectors of concrete functions and
 * parsing of concrete calls: those belong to the standards and live
 * in their own modules.
 */

/** ABI word length in hex characters: thirty-two bytes. */
export const WORD_LENGTH = 64

/** Function-selector length in hex characters: four bytes. */
export const SELECTOR_LENGTH = 8

/** Address length in hex characters: twenty bytes. */
export const ADDRESS_LENGTH = 40

/** Largest `uint256` value. */
export const MAX_UINT256 = (1n << 256n) - 1n

/** Address padding inside a word: the high bytes that must be zero. */
const ADDRESS_PADDING = WORD_LENGTH - ADDRESS_LENGTH

/**
 * Function selector — the first four bytes of keccak256 of its signature.
 *
 * VALUES ARE COMPUTED, NOT PASTED AS CONSTANTS. Eight hex characters
 * copied from memory are unverifiable on a code read: a one-character
 * error calls a function that does not exist and the contract refuses
 * with no useful reason. The signature is readable and can be checked
 * against the standard by eye.
 */
export function functionSelector(signature: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, SELECTOR_LENGTH)
}

/**
 * Event id in a log — keccak256 of the whole signature.
 *
 * It differs from a function selector in length: an event occupies
 * all thirty-two bytes, a function the first four. Mixing them up
 * means searching the logs for something that is not there and
 * getting an empty list with no error at all.
 */
export function eventTopic(signature: string): HexString {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(signature)))}` as HexString
}

export function strip(data: HexString | string): string {
  return data.startsWith('0x') ? data.slice(2) : data
}

/**
 * Encodes an unsigned integer as a word.
 *
 * @throws RangeError if the value is negative or does not fit in
 *         `uint256`. Silently truncating would produce a call with a
 *         different amount or about a different item.
 */
export function encodeUintWord(value: bigint): string {
  if (value < 0n) {
    throw new RangeError('The value cannot be negative.')
  }

  if (value > MAX_UINT256) {
    throw new RangeError('The value does not fit into uint256.')
  }

  return value.toString(16).padStart(WORD_LENGTH, '0')
}

/**
 * Encodes an address as a word.
 *
 * Case is forced to lower: the contract compares bytes, and an
 * EIP-55 checksum spelling would be read as a different value.
 */
export function encodeAddressWord(address: Address): string {
  return address.slice(2).toLowerCase().padStart(WORD_LENGTH, '0')
}

export function encodeCall(selector: string): HexString {
  return `0x${selector}` as HexString
}

export function encodeCallWithAddress(selector: string, address: Address): HexString {
  return `0x${selector}${encodeAddressWord(address)}` as HexString
}

export function encodeCallWithUint(selector: string, value: bigint): HexString {
  return `0x${selector}${encodeUintWord(value)}` as HexString
}

export function encodeCallWithAddressAndUint(
  selector: string,
  address: Address,
  value: bigint,
): HexString {
  return `0x${selector}${encodeAddressWord(address)}${encodeUintWord(value)}` as HexString
}

export function encodeCallWithTwoAddresses(
  selector: string,
  first: Address,
  second: Address,
): HexString {
  return `0x${selector}${encodeAddressWord(first)}${encodeAddressWord(second)}` as HexString
}

/**
 * Reads an address from a word, checking alignment.
 *
 * THIS IS A SAFETY CHECK, NOT A FORMALITY. The address occupies the
 * low twenty bytes; a word with non-zero high bytes is not an
 * address. Reading it as one would show, on the confirmation screen,
 * a recipient who is not in the call.
 *
 * @returns `null` if the word is not an address.
 */
export function readAddressWord(word: string): Address | null {
  if (word.length !== WORD_LENGTH) {
    return null
  }

  if (word.slice(0, ADDRESS_PADDING) !== '0'.repeat(ADDRESS_PADDING)) {
    return null
  }

  return toAddress(`0x${word.slice(ADDRESS_PADDING)}`)
}

/**
 * Reads an unsigned integer from a contract response.
 *
 * @throws Error if the response is empty: that means the function is
 *         missing.
 */
export function decodeUint(data: HexString): bigint {
  const body = strip(data)

  if (body === '') {
    throw new Error('the contract returned an empty response')
  }

  return BigInt(`0x${body.slice(0, WORD_LENGTH)}`)
}

/**
 * Reads a boolean from a contract response.
 *
 * A non-zero word means `true`. An empty response means the function
 * is missing: for ERC-165 that is a legal case — old contracts do
 * not declare the interface at all.
 */
export function decodeBool(data: HexString): boolean {
  const body = strip(data)

  return body === '' ? false : BigInt(`0x${body.slice(0, WORD_LENGTH)}`) !== 0n
}

/**
 * Reads an address from a contract response.
 *
 * @throws Error if the response is shorter than a word or the word
 *         is not an address.
 */
export function decodeAddress(data: HexString): Address {
  const body = strip(data)

  if (body.length < WORD_LENGTH) {
    throw new Error('the contract returned a response shorter than one word')
  }

  const address = readAddressWord(body.slice(0, WORD_LENGTH))

  if (address === null) {
    throw new Error('the response is not an address')
  }

  return address
}
