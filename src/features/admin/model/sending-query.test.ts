import { describe, expect, it } from 'vitest'

import type { IRemoteSending } from '@/features/onboarding'

import { sendingMatchesAdminQuery } from './sending-query'

const SENDING: IRemoteSending = {
  id: '61',
  createdAt: '2026-08-22T14:44:10.949Z',
  userId: '74',
  status: 'pending',
  failureMessage: null,
  recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  amount: '2',
  symbol: 'ETH',
}

describe('sendingMatchesAdminQuery', () => {
  it('находит по адресу получателя', () => {
    expect(sendingMatchesAdminQuery(SENDING, '6b175474')).toBe(true)
    expect(sendingMatchesAdminQuery(SENDING, 'zzzz')).toBe(false)
  })

  it('находит по статусу, сумме и тикеру', () => {
    expect(sendingMatchesAdminQuery(SENDING, 'pending')).toBe(true)
    expect(sendingMatchesAdminQuery(SENDING, '2')).toBe(true)
    expect(sendingMatchesAdminQuery(SENDING, 'eth')).toBe(true)
  })
})
