import { describe, expect, it } from 'vitest'

import { readSendingAmount } from './amount.ts'

describe('readSendingAmount', () => {
  it('принимает целое и десятичное число', () => {
    expect(readSendingAmount('1')).toBe('1')
    expect(readSendingAmount(' 0.01 ')).toBe('0.01')
  })

  it('отвергает тикер и пустую строку', () => {
    expect(readSendingAmount('1 ETH')).toBeNull()
    expect(readSendingAmount('2 USDT')).toBeNull()
    expect(readSendingAmount('')).toBeNull()
    expect(readSendingAmount('   ')).toBeNull()
  })
})
