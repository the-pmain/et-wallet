import { describe, expect, it } from 'vitest'

import { readSendingAmount } from './amount.ts'

describe('readSendingAmount', () => {
  it('accepts an integer and a decimal', () => {
    expect(readSendingAmount('1')).toBe('1')
    expect(readSendingAmount(' 0.01 ')).toBe('0.01')
  })

  it('rejects a ticker and an empty string', () => {
    expect(readSendingAmount('1 ETH')).toBeNull()
    expect(readSendingAmount('2 USDT')).toBeNull()
    expect(readSendingAmount('')).toBeNull()
    expect(readSendingAmount('   ')).toBeNull()
  })
})
