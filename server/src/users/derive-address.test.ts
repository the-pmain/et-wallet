import { describe, expect, it } from 'vitest'

import { addressIndexForCodename, deriveWalletAddress } from './derive-address.ts'
import {
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
} from './wallets.ts'

/**
 * The BIP-39 reference phrase. Addresses below are the published
 * vectors for `m/44'/60'/0'/0/0` and `…/1`: a change in the path or
 * in the seed passphrase moves them, and the client wallet would
 * then show different addresses than the cabinet.
 */
const PHRASE =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

const ADDRESS_AT_0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const ADDRESS_AT_1 = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'

describe('deriveWalletAddress', () => {
  it('derives the reference address at index 0', () => {
    expect(deriveWalletAddress(PHRASE, 0)).toBe(ADDRESS_AT_0)
  })

  it('derives the reference address at index 1', () => {
    expect(deriveWalletAddress(PHRASE, 1)).toBe(ADDRESS_AT_1)
  })

  it('accepts a space-separated phrase as well', () => {
    expect(deriveWalletAddress(PHRASE.split(',').join(' '), 0)).toBe(ADDRESS_AT_0)
  })

  it('refuses a phrase with a broken checksum', () => {
    const broken = PHRASE.split(',').with(11, 'abandon').join(',')

    expect(deriveWalletAddress(broken, 0)).toBeNull()
  })

  it('refuses an empty phrase and a negative index', () => {
    expect(deriveWalletAddress('', 0)).toBeNull()
    expect(deriveWalletAddress(PHRASE, -1)).toBeNull()
  })
})

describe('addressIndexForCodename', () => {
  it('maps the two generated roles to fixed indices', () => {
    expect(addressIndexForCodename(WALLET_CODENAME_RECEIVING_FUNDS)).toBe(0)
    expect(addressIndexForCodename(WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE)).toBe(1)
  })

  it('has no index for an unknown role', () => {
    expect(addressIndexForCodename('wallet-0xabc')).toBeNull()
  })
})
