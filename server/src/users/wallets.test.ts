import { describe, expect, it } from 'vitest'

import {
  emptyWallets,
  mergeWallet,
  parseWallets,
  readWalletValue,
  readWalletsPayload,
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  withZeroBalances,
} from './wallets.ts'

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const ADDRESS_LOWER = ADDRESS.toLowerCase()
const SLOT = { key: ADDRESS, value: '0' }

describe('wallets', () => {
  it('empty input yields an empty map', () => {
    expect(parseWallets(null)).toEqual({})
    expect(parseWallets(undefined)).toEqual({})
    expect(parseWallets([])).toEqual({})
    expect(emptyWallets()).toEqual({})
  })

  it('accepts a map by codename and a list of records', () => {
    expect(
      parseWallets({
        [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
      }),
    ).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })

    expect(parseWallets([{ key: ADDRESS, value: '0', codename: WALLET_CODENAME_RECEIVING_FUNDS }])).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
  })

  it('reads the legacy address map', () => {
    expect(
      parseWallets({
        [ADDRESS]: '0',
        notAnAddress: 'skip',
        [ADDRESS_LOWER]: 1,
      }),
    ).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
  })

  it('replaces the slot with the same codename', () => {
    const first = mergeWallet({}, WALLET_CODENAME_RECEIVING_FUNDS, ADDRESS_LOWER, '0')
    const second = mergeWallet(first, WALLET_CODENAME_RECEIVING_FUNDS, ADDRESS, '1')

    expect(first).toEqual({ [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT })
    expect(second).toEqual({ [WALLET_CODENAME_RECEIVING_FUNDS]: { key: ADDRESS, value: '1' } })
  })

  it('adds an exchange slot apart from the primary', () => {
    const exchangeAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
    const wallets = mergeWallet(
      { [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT },
      WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
      exchangeAddress,
      '0',
    )

    expect(wallets).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
      [WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE]: { key: exchangeAddress, value: '0' },
    })
  })

  it('rejects an empty and an overly long value', () => {
    expect(readWalletValue('  ')).toBeNull()
    expect(readWalletValue('a'.repeat(65))).toBeNull()
    expect(readWalletValue(' 0 ')).toBe('0')
  })

  it('accepts a map and a list from the request body', () => {
    expect(readWalletsPayload(undefined)).toEqual({})
    expect(
      readWalletsPayload({
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key: ADDRESS, value: ' 0 ' },
      }),
    ).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
    expect(readWalletsPayload([{ key: ADDRESS, value: '0' }])).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
    expect(readWalletsPayload({ key: 'not-an-address', value: '0' })).toBeNull()
    expect(readWalletsPayload({ [ADDRESS]: '0' })).toBeNull()
  })

  it('zeros map values', () => {
    expect(withZeroBalances({ [WALLET_CODENAME_RECEIVING_FUNDS]: { key: ADDRESS, value: '2500' } })).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
  })
})
