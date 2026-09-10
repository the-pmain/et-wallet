import {
  SELECTOR_LENGTH,
  WORD_LENGTH,
  encodeAddressWord,
  encodeUintWord,
  functionSelector,
  readAddressWord,
  strip,
} from '@/core/abi'
import type { Address, HexString } from '@/core/types'

/**
 * ERC-20 call encoding.
 *
 * THIS MODULE HOLDS ONLY STANDARD KNOWLEDGE: function selectors and
 * argument parsing. Encoding rules — word length, address padding,
 * reading numbers and strings — live in `core/abi` and are shared
 * by every contract.
 */

const selector = functionSelector

export const DECIMALS_SELECTOR = selector('decimals()')

export const SYMBOL_SELECTOR = selector('symbol()')

export const NAME_SELECTOR = selector('name()')

export const BALANCE_OF_SELECTOR = selector('balanceOf(address)')

export const TRANSFER_SELECTOR = selector('transfer(address,uint256)')

/**
 * Encodes a `transfer(address,uint256)` call.
 *
 * THIS IS WHERE A MISTAKE COSTS FUNDS. Call data is the only thing
 * that names the token recipient and amount: the transaction's own
 * `to` points at the contract, not at a person. A encoding error
 * sends tokens elsewhere, and they cannot be returned.
 *
 * ENCODING IS DONE IN THE CORE, NOT IN THE UI. The send screen
 * works with a recipient and an amount; assembling call bytes from
 * them is the job of the layer that knows the standard.
 *
 * @throws RangeError if the amount is negative or does not fit
 *         in `uint256`: a silently truncated value would send
 *         a completely different amount than the user confirmed.
 */
export function encodeTransfer(to: Address, amount: bigint): HexString {
  return `0x${TRANSFER_SELECTOR}${encodeAddressWord(to)}${encodeUintWord(amount)}` as HexString
}

/**
 * Parses a `transfer(address,uint256)` call.
 *
 * WHY READ BACK WHAT WE ASSEMBLED. History is built from the signed
 * transaction data, not from the intent that existed before the
 * signature. That way history records exactly what went on-chain:
 * if the form and the signature diverged, the record shows the
 * actual contents, not the desired ones.
 *
 * @returns `null` if the data is not a `transfer` call of the
 *          expected length. Throwing here is wrong: a token transfer
 *          is only one of the possible calls.
 */
export function decodeTransfer(
  data: HexString,
): { readonly to: Address; readonly amount: bigint } | null {
  const body = strip(data)

  /* The selector is four bytes, the arguments two words. Longer
     data means a different call that happens to start the same way. */
  if (body.length !== SELECTOR_LENGTH + WORD_LENGTH * 2) {
    return null
  }

  if (body.slice(0, SELECTOR_LENGTH) !== TRANSFER_SELECTOR) {
    return null
  }

  /* A word with non-zero high bytes is not an address: presenting
     it as the recipient would show on the confirmation screen
     someone who is not in the call. */
  const to = readAddressWord(body.slice(SELECTOR_LENGTH, SELECTOR_LENGTH + WORD_LENGTH))

  if (to === null) {
    return null
  }

  return { to, amount: BigInt(`0x${body.slice(SELECTOR_LENGTH + WORD_LENGTH)}`) }
}

/**
 * Reads a string from a contract response.
 *
 * TWO RESPONSE SHAPES ARE SUPPORTED, AND THAT IS NOT REDUNDANCY.
 *
 * ERC-20 declares `symbol()` and `name()` as returning `string`,
 * i.e. variable-length data: offset, length, contents. A large
 * share of early tokens — MKR among the best known — shipped
 * before the final standard and return `bytes32` right-padded
 * with zeros.
 *
 * A decoder that understands only `string` will not add those
 * tokens at all. They are told apart by response length: exactly
 * one word means `bytes32`, two or more — a variable-length string.
 *
 * @throws Error if the response is empty or cannot be parsed.
 */
export function decodeString(data: HexString): string {
  const body = strip(data)

  if (body === '') {
    throw new Error('the contract returned an empty response')
  }

  /* One word is `bytes32`: the value sits in it, right-padded
     with zeros to the end. */
  if (body.length <= WORD_LENGTH) {
    return decodeBytes32(body)
  }

  return decodeDynamicString(body)
}

/**
 * Parses a variable-length ABI-encoded string.
 *
 * The first word is the offset to the data; the word at that offset
 * is the length in bytes, then the contents. The offset is read,
 * not assumed to be 32: the standard does not guarantee that.
 */
function decodeDynamicString(body: string): string {
  const offset = Number(BigInt(`0x${body.slice(0, WORD_LENGTH)}`)) * 2
  const lengthStart = offset
  const lengthEnd = lengthStart + WORD_LENGTH

  if (lengthEnd > body.length) {
    throw new Error('the response is shorter than the declared offset')
  }

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthEnd)}`)) * 2
  const content = body.slice(lengthEnd, lengthEnd + length)

  return hexToUtf8(content)
}

/** Parses `bytes32`: contents up to the first zero byte. */
function decodeBytes32(body: string): string {
  const padded = body.padEnd(WORD_LENGTH, '0')

  /* A zero byte can land on an odd position inside a character —
     then it is part of a significant byte, not an end marker.
     The search walks pairs of characters. */
  let end = padded.length

  for (let index = 0; index < padded.length; index += 2) {
    if (padded.slice(index, index + 2) === '00') {
      end = index
      break
    }
  }

  return hexToUtf8(padded.slice(0, end))
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return new TextDecoder().decode(bytes)
}
