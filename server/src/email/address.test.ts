import { describe, expect, it } from 'vitest'

import { isEmailAddress } from './address.ts'

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
