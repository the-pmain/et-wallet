import { describe, expect, it } from 'vitest'

import { EMPTY_REMOTE_ASSETS } from '@/features/onboarding/model/RemoteUserDirectory'

import { userMatchesAdminQuery } from './admin-query'

const KEY = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const JAMES = {
  id: '51',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [{ key: KEY, value: '0' }],
  assets: EMPTY_REMOTE_ASSETS,
}

const MARIA = {
  id: '52',
  email: 'maria@example.com',
  balance: '0',
  createdAt: '2026-08-20T12:00:00.000Z',
  wallets: [],
  assets: EMPTY_REMOTE_ASSETS,
}

describe('userMatchesAdminQuery', () => {
  it('находит запись по почте', () => {
    expect(userMatchesAdminQuery(JAMES, 'james@')).toBe(true)
    expect(userMatchesAdminQuery(MARIA, 'james@')).toBe(false)
  })

  it('находит запись по адресу кошелька', () => {
    expect(userMatchesAdminQuery(JAMES, '5aaeb605')).toBe(true)
    expect(userMatchesAdminQuery(JAMES, KEY)).toBe(true)
    expect(userMatchesAdminQuery(MARIA, '5aaeb605')).toBe(false)
  })

  it('пустой запрос не отсекает никого', () => {
    expect(userMatchesAdminQuery(JAMES, '  ')).toBe(true)
    expect(userMatchesAdminQuery(MARIA, '')).toBe(true)
  })
})
