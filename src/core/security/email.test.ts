import { describe, expect, it } from 'vitest'

import { MAX_EMAIL_LENGTH, isValidEmail, normalizeEmail } from './email'

describe('normalizeEmail', () => {
  it('убирает крайние пробелы и приводит к нижнему регистру', () => {
    expect(normalizeEmail('  James@Mail.COM  ')).toBe('james@mail.com')
  })
})

describe('isValidEmail', () => {
  it('принимает обычный адрес', () => {
    expect(isValidEmail('james@example.com')).toBe(true)
    expect(isValidEmail('  james@example.com  ')).toBe(true)
  })

  it('отвергает пустое значение и имя без адреса', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
    expect(isValidEmail('James')).toBe(false)
    expect(isValidEmail('not-an-email')).toBe(false)
  })

  it('отвергает адрес длиннее ограничения', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH)
    expect(isValidEmail(`${local}@x.io`)).toBe(false)
  })
})
