import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'

import {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  APPROVE_SELECTOR,
  IS_APPROVED_FOR_ALL_SELECTOR,
  SET_APPROVAL_FOR_ALL_SELECTOR,
  encodeAllowance,
  encodeRevokeAllowance,
  encodeRevokeApprovalForAll,
} from './abi'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('Selectors and topics match the standard ones', () => {
  /* The values are well known and published in the specs; here
     they are computed from signatures. An error in a signature
     would yield an empty allowance list with no error at all —
     the wallet would silently tell the owner they allowed nothing. */
  it.each([
    ['allowance(address,address)', ALLOWANCE_SELECTOR, 'dd62ed3e'],
    ['isApprovedForAll(address,address)', IS_APPROVED_FOR_ALL_SELECTOR, 'e985e9c5'],
    ['approve(address,uint256)', APPROVE_SELECTOR, '095ea7b3'],
    ['setApprovalForAll(address,bool)', SET_APPROVAL_FOR_ALL_SELECTOR, 'a22cb465'],
  ])('%s', (_signature, actual: string, expected: string) => {
    expect(actual).toBe(expected)
  })

  it('Approval topic', () => {
    expect(APPROVAL_TOPIC).toBe(
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    )
  })

  it('ApprovalForAll topic', () => {
    expect(APPROVAL_FOR_ALL_TOPIC).toBe(
      '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
    )
  })
})

describe('Encoding an allowance read', () => {
  it('the owner comes first, the spender second', () => {
    /* Swapping them reads someone else's allowance and shows
       the owner they granted nothing. */
    const encoded = encodeAllowance(ALLOWANCE_SELECTOR, OWNER, SPENDER)

    expect(encoded.slice(10, 74)).toContain(OWNER.slice(2).toLowerCase())
    expect(encoded.slice(74)).toContain(SPENDER.slice(2).toLowerCase())
  })
})

describe('Encoding a revoke', () => {
  it('for a token a revoke is a grant of zero', () => {
    /* The standard has no separate "revoke" function: the
       allowance is overwritten. */
    const encoded = encodeRevokeAllowance(SPENDER)

    expect(encoded.slice(0, 10)).toBe(`0x${APPROVE_SELECTOR}`)
    expect(encoded.slice(10, 74)).toContain(SPENDER.slice(2).toLowerCase())
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(0n)
  })

  it('for a collection a revoke clears the flag', () => {
    const encoded = encodeRevokeApprovalForAll(SPENDER)

    expect(encoded.slice(0, 10)).toBe(`0x${SET_APPROVAL_FOR_ALL_SELECTOR}`)
    expect(BigInt(`0x${encoded.slice(74)}`)).toBe(0n)
  })

  it('revoke data occupies exactly 68 bytes', () => {
    expect(encodeRevokeAllowance(SPENDER)).toHaveLength(2 + 8 + 64 * 2)
    expect(encodeRevokeApprovalForAll(SPENDER)).toHaveLength(2 + 8 + 64 * 2)
  })
})
