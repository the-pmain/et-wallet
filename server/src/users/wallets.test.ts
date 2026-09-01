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
  it('пустой ввод даёт пустую карту', () => {
    expect(parseWallets(null)).toEqual({})
    expect(parseWallets(undefined)).toEqual({})
    expect(parseWallets([])).toEqual({})
    expect(emptyWallets()).toEqual({})
  })

  it('принимает карту по codename и список записей', () => {
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

  it('читает прежнюю карту адресов', () => {
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

  it('заменяет слот с тем же codename', () => {
    const first = mergeWallet({}, WALLET_CODENAME_RECEIVING_FUNDS, ADDRESS_LOWER, '0')
    const second = mergeWallet(first, WALLET_CODENAME_RECEIVING_FUNDS, ADDRESS, '1')

    expect(first).toEqual({ [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT })
    expect(second).toEqual({ [WALLET_CODENAME_RECEIVING_FUNDS]: { key: ADDRESS, value: '1' } })
  })

  it('добавляет exchange-слот отдельно от основного', () => {
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

  it('отвергает пустое и слишком длинное значение', () => {
    expect(readWalletValue('  ')).toBeNull()
    expect(readWalletValue('a'.repeat(65))).toBeNull()
    expect(readWalletValue(' 0 ')).toBe('0')
  })

  it('принимает карту и список из тела запроса', () => {
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

  it('обнуляет значения карты', () => {
    expect(withZeroBalances({ [WALLET_CODENAME_RECEIVING_FUNDS]: { key: ADDRESS, value: '2500' } })).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: SLOT,
    })
  })
})
