import { describe, expect, it } from 'vitest'

import { emailsMatch } from './emails.ts'

describe('emailsMatch', () => {
  it('принимает тот же адрес без учёта регистра', () => {
    expect(emailsMatch('James@Mail.com', 'james@mail.com')).toBe(true)
  })

  it('отвергает другой адрес', () => {
    expect(emailsMatch('james@example.com', 'maria@example.com')).toBe(false)
  })

  it('отвергает отсутствие почты в записи', () => {
    expect(emailsMatch(null, 'james@example.com')).toBe(false)
    expect(emailsMatch(undefined, 'james@example.com')).toBe(false)
  })
})
