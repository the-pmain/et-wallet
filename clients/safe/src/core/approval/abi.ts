import {
  encodeAddressWord,
  encodeCallWithTwoAddresses,
  encodeUintWord,
  eventTopic,
  functionSelector,
} from '@/core/abi'
import type { Address, HexString } from '@/core/types'

/**
 * Encoding of calls and events that belong to allowances.
 *
 * VALUES ARE COMPUTED FROM SIGNATURES, not pasted as constants.
 * An event hash copied from memory is unverifiable when reading the
 * code: one wrong character yields an empty allowance list with no
 * error at all — the wallet silently tells the owner they have
 * allowed nothing to anyone.
 */

/**
 * `Approval(address,address,uint256)` — an ERC-20 allowance grant.
 *
 * Owner and spender are indexed; the amount sits in the data.
 * ERC-721 uses an event of the same name, but also indexes the
 * token id — four topics instead of three. A single-item allowance
 * is not considered here: it vanishes on the first transfer.
 */
export const APPROVAL_TOPIC = eventTopic('Approval(address,address,uint256)')

/**
 * `ApprovalForAll(address,address,bool)` — an allowance on the whole collection.
 *
 * The most dangerous of the existing ones: one signature hands over
 * every item in the collection, including those the owner does not
 * yet have.
 */
export const APPROVAL_FOR_ALL_TOPIC = eventTopic('ApprovalForAll(address,address,bool)')

export const ALLOWANCE_SELECTOR = functionSelector('allowance(address,address)')

export const IS_APPROVED_FOR_ALL_SELECTOR = functionSelector('isApprovedForAll(address,address)')

export const APPROVE_SELECTOR = functionSelector('approve(address,uint256)')

export const SET_APPROVAL_FOR_ALL_SELECTOR = functionSelector('setApprovalForAll(address,bool)')

/** Topic count of an ERC-20 `Approval` event: id plus two addresses. */
export const ERC20_APPROVAL_TOPIC_COUNT = 3

/**
 * Encodes a read of the live allowance.
 *
 * Argument order is fixed by the standard: owner first, then the
 * spender. Swapping them reads someone else's allowance and shows
 * the owner they granted nothing.
 */
export function encodeAllowance(selector: string, owner: Address, spender: Address): HexString {
  return encodeCallWithTwoAddresses(selector, owner, spender)
}

/**
 * Encodes an ERC-20 allowance revoke.
 *
 * A REVOKE IS A GRANT OF ZERO. The standard has no separate "revoke"
 * function: the allowance is overwritten, and zero means "nothing
 * to spend".
 */
export function encodeRevokeAllowance(spender: Address): HexString {
  return `0x${APPROVE_SELECTOR}${encodeAddressWord(spender)}${encodeUintWord(0n)}` as HexString
}

/**
 * Encodes a collection-wide allowance revoke.
 *
 * The boolean occupies a whole word: false is a word of zeros.
 */
export function encodeRevokeApprovalForAll(operator: Address): HexString {
  return `0x${SET_APPROVAL_FOR_ALL_SELECTOR}${encodeAddressWord(operator)}${encodeUintWord(0n)}` as HexString
}
