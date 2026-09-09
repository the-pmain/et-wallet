import { describe, expect, it } from 'vitest'

import { emailsMatch } from './emails.ts'

describe('emailsMatch', () => {
  it('accepts the same address case-insensitively', () => {
    expect(emailsMatch('James@Mail.com', 'james@mail.com')).toBe(true)
  })

  it('rejects a different address', () => {
    expect(emailsMatch('james@example.com', 'maria@example.com')).toBe(false)
  })

  it('rejects a missing email on the record', () => {
    expect(emailsMatch(null, 'james@example.com')).toBe(false)
    expect(emailsMatch(undefined, 'james@example.com')).toBe(false)
  })
})
