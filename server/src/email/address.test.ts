import { describe, expect, it } from 'vitest'

import { emailDomain, isEmailAddress, sendingFromAddresses } from './address.ts'

describe('isEmailAddress', () => {
  it('accepts an ordinary address', () => {
    expect(isEmailAddress('custom123@etwalletx.com')).toBe(true)
    expect(isEmailAddress('  james@example.com  ')).toBe(true)
  })

  it('rejects empty and missing-domain values', () => {
    expect(isEmailAddress('')).toBe(false)
    expect(isEmailAddress('james')).toBe(false)
    expect(isEmailAddress('james@localhost')).toBe(false)
    expect(isEmailAddress('james@example')).toBe(false)
  })
})

describe('emailDomain', () => {
  it('extracts the domain', () => {
    expect(emailDomain('support@etwalletx.com')).toBe('etwalletx.com')
    expect(emailDomain('  Custom123@ETWALLETX.COM  ')).toBe('etwalletx.com')
    expect(emailDomain('not-an-email')).toBeNull()
  })
})

describe('sendingFromAddresses', () => {
  it('builds support, hello and the rest on the MAIL_FROM domain', () => {
    expect(sendingFromAddresses('support@etwalletx.com')).toEqual([
      'support@etwalletx.com',
      'hello@etwalletx.com',
      'info@etwalletx.com',
      'contact@etwalletx.com',
      'team@etwalletx.com',
      'mail@etwalletx.com',
      'enquiries@etwalletx.com',
    ])
  })

  it('puts MAIL_FROM first when it is not in the base list', () => {
    expect(sendingFromAddresses('office@etwalletx.com')[0]).toBe('office@etwalletx.com')
  })

  it('without an address returns an empty list', () => {
    expect(sendingFromAddresses(null)).toEqual([])
  })
})
