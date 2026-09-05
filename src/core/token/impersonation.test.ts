import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'

import { findTokenImpersonation } from './impersonation'
import { listVerifiedTokens } from './verified'

const ETHEREUM = BUILT_IN_CHAIN_ID.Ethereum

/** Verified USDC on Ethereum. */
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const IMPOSTOR = toAddress('0x1111111111111111111111111111111111111111')

function check(symbol: string, name = 'Some Token', address = IMPOSTOR) {
  return findTokenImpersonation({ chainId: ETHEREUM, address, symbol, name })
}

describe('Impersonation of a verified token', () => {
  it('a foreign contract with a verified symbol is recognised', () => {
    /* The symbol is set by the contract author: anyone can call
       themselves `USDC`, and the owner will see the familiar one
       in the list and send funds. */
    expect(check('USDC')?.verified.address).toBe(USDC)
  })

  it('a Cyrillic letter in the symbol does not help', () => {
    /* `USDC` with a Cyrillic C (U+0421) matches the real one in no byte,
       and on screen it is the same word. */
    const found = check('USD\u0421')

    expect(found?.verified.address).toBe(USDC)
    expect(found?.foreignCharacters).toEqual(['\u0421'])
  })

  it('a name match is recognised as well', () => {
    const found = check('XYZ', 'USD Coin')

    expect(found?.field).toBe('name')
  })

  it('the symbol is checked before the name', () => {
    /* The symbol is shown in the asset list and on send
       confirmation; the full name is not visible everywhere. */
    expect(check('USDC', 'USD Coin')?.field).toBe('symbol')
  })

  it('the verified contract itself is not treated as a fake', () => {
    /* It is allowed to use its own name. */
    expect(check('USDC', 'USD Coin', USDC)).toBeNull()
  })

  it('an ordinary token does not raise an alarm', () => {
    /* A false alarm is worse than no check: it trains people not
       to read warnings. */
    expect(check('MYTOKEN', 'My Own Token')).toBeNull()
    expect(check('SHIB', 'Shiba Inu')).toBeNull()
  })

  it('an empty symbol is not treated as a match', () => {
    /* An empty skeleton would match anything. */
    expect(check('', '')).toBeNull()
  })

  it('the check is against its own network', () => {
    /* Each network has its own list: the USDC address on Polygon
       is different, and that is what to compare against. */
    const polygon = listVerifiedTokens(BUILT_IN_CHAIN_ID.Polygon)

    expect(
      findTokenImpersonation(
        { chainId: BUILT_IN_CHAIN_ID.Polygon, address: USDC, symbol: 'USDC', name: 'x' },
        polygon,
      ),
    ).not.toBeNull()
  })
})
