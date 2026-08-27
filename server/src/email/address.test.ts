import { describe, expect, it } from 'vitest'

import { emailDomain, isEmailAddress, sendingFromAddresses } from './address.ts'

describe('isEmailAddress', () => {
  it('принимает обычный адрес', () => {
    expect(isEmailAddress('custom123@etwalletx.com')).toBe(true)
    expect(isEmailAddress('  james@example.com  ')).toBe(true)
  })

  it('отвергает пустое и без домена', () => {
    expect(isEmailAddress('')).toBe(false)
    expect(isEmailAddress('james')).toBe(false)
    expect(isEmailAddress('james@localhost')).toBe(false)
    expect(isEmailAddress('james@example')).toBe(false)
  })
})

describe('emailDomain', () => {
  it('достаёт домен', () => {
    expect(emailDomain('support@etwalletx.com')).toBe('etwalletx.com')
    expect(emailDomain('  Custom123@ETWALLETX.COM  ')).toBe('etwalletx.com')
    expect(emailDomain('not-an-email')).toBeNull()
  })
})

describe('sendingFromAddresses', () => {
  it('собирает support, hello и остальные на домене MAIL_FROM', () => {
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

  it('ставит MAIL_FROM первым, если его нет в базовом списке', () => {
    expect(sendingFromAddresses('office@etwalletx.com')[0]).toBe('office@etwalletx.com')
  })

  it('без адреса возвращает пустой список', () => {
    expect(sendingFromAddresses(null)).toEqual([])
  })
})
