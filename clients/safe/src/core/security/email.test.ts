import { describe, expect, it } from 'vitest'

import { MAX_EMAIL_LENGTH, isValidEmail, normalizeEmail } from './email'

describe('normalizeEmail', () => {
  it('strips edge spaces and lowercases', () => {
    expect(normalizeEmail('  James@Mail.COM  ')).toBe('james@mail.com')
  })
})

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('james@example.com')).toBe(true)
    expect(isValidEmail('  james@example.com  ')).toBe(true)
  })

  it('rejects an empty value and a name without an address', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
    expect(isValidEmail('James')).toBe(false)
    expect(isValidEmail('not-an-email')).toBe(false)
  })

  it('rejects an address longer than the limit', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH)
    expect(isValidEmail(`${local}@x.io`)).toBe(false)
  })
})
