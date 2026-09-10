import { describe, expect, it } from 'vitest'

import { formatAdminListAmount, formatAdminRecordId } from './admin-transfer-display'

describe('formatAdminListAmount', () => {
  it('keeps a short stored amount', () => {
    expect(formatAdminListAmount('510')).toBe('510')
    expect(formatAdminListAmount('0.15')).toBe('0.15')
    expect(formatAdminListAmount('1000.12')).toBe('1000.12')
  })

  it('cuts a long fraction so the row can be scanned', () => {
    expect(formatAdminListAmount('6045.705533835798637701')).toBe('6045.705533')
  })

  it('renders an empty amount as an em dash', () => {
    expect(formatAdminListAmount(null)).toBe('—')
    expect(formatAdminListAmount('')).toBe('—')
  })
})

describe('formatAdminRecordId', () => {
  it('keeps a short numeric id', () => {
    expect(formatAdminRecordId('62')).toBe('62')
  })

  it('shortens a uuid', () => {
    expect(formatAdminRecordId('9ad076c0-2b45-43f5-8727-dee9156be388')).toBe('9ad076c0…')
  })
})
