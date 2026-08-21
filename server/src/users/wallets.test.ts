import { describe, expect, it } from 'vitest'

import {
  emptyWallets,
  mergeWallet,
  parseWallets,
  readWalletValue,
  readWalletsPayload,
} from './wallets.ts'

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const ADDRESS_LOWER = ADDRESS.toLowerCase()
const ENTRY = { key: ADDRESS, value: '0' }

describe('wallets', () => {
  it('пустой ввод даёт пустой список', () => {
    expect(parseWallets(null)).toEqual([])
    expect(parseWallets(undefined)).toEqual([])
    expect(parseWallets([])).toEqual([])
    expect(emptyWallets()).toEqual([])
  })

  it('принимает объект { key, value } и список таких объектов', () => {
    expect(parseWallets(ENTRY)).toEqual([ENTRY])
    expect(parseWallets([ENTRY, { key: ADDRESS_LOWER, value: '1' }])).toEqual([
      { key: ADDRESS, value: '1' },
    ])
  })

  it('читает прежнюю карту адресов', () => {
    expect(
      parseWallets({
        [ADDRESS]: '0',
        notAnAddress: 'skip',
        [ADDRESS_LOWER]: 1,
      }),
    ).toEqual([ENTRY])
  })

  it('пишет ключ в контрольной сумме и не плодит дубликаты', () => {
    const first = mergeWallet([], ADDRESS_LOWER, '0')
    const second = mergeWallet(first, ADDRESS, '1')

    expect(first).toEqual([ENTRY])
    expect(second).toEqual([{ key: ADDRESS, value: '1' }])
    expect(second).toHaveLength(1)
  })

  it('отвергает пустое и слишком длинное значение', () => {
    expect(readWalletValue('  ')).toBeNull()
    expect(readWalletValue('a'.repeat(65))).toBeNull()
    expect(readWalletValue(' 0 ')).toBe('0')
  })

  it('принимает { key, value } из тела запроса и отвергает битые ключи', () => {
    expect(readWalletsPayload(undefined)).toEqual([])
    expect(readWalletsPayload({ key: ADDRESS, value: ' 0 ' })).toEqual([ENTRY])
    expect(readWalletsPayload([{ key: ADDRESS, value: '0' }])).toEqual([ENTRY])
    expect(readWalletsPayload({ key: 'not-an-address', value: '0' })).toBeNull()
    expect(readWalletsPayload({ [ADDRESS]: '0' })).toBeNull()
  })
})
