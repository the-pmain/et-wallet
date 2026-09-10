import { describe, expect, it } from 'vitest'

import { WeakPasswordError } from '@/core/errors'

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE,
  PASSWORD_STRENGTH,
  assertAcceptablePassword,
  assessPassword,
} from './password-policy'

describe('assessPassword: length', () => {
  it('rejects an empty password', () => {
    expect(assessPassword('').issues).toContain(PASSWORD_ISSUE.TooShort)
    expect(assessPassword('').isAcceptable).toBe(false)
  })

  it('accepts a short simple password', () => {
    expect(assessPassword('123456').isAcceptable).toBe(true)
    expect(assessPassword('1').isAcceptable).toBe(true)
  })

  it('the minimum is one character', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(1)
  })

  it('rejects an overly long password', () => {
    /* Not a strength limit: PBKDF2 hashes any length.
       It guards against pasting megabytes of text, whose key
       derivation would freeze the UI. */
    expect(assessPassword(`Ab1!${'x'.repeat(300)}`).issues).toContain(PASSWORD_ISSUE.TooLong)
    expect(assessPassword(`Ab1!${'x'.repeat(300)}`).isAcceptable).toBe(false)
  })
})

describe('assessPassword: character classes', () => {
  it('notes too few classes but does not reject the password', () => {
    expect(assessPassword('abcdefghijklmnop').issues).toContain(PASSWORD_ISSUE.TooFewClasses)
    expect(assessPassword('abcdefghijklmnop').isAcceptable).toBe(true)
  })

  it('accepts three classes', () => {
    expect(assessPassword('Abcdefgh1234').issues).not.toContain(PASSWORD_ISSUE.TooFewClasses)
  })

  it('recognises all four classes', () => {
    expect(assessPassword('Abcdefgh123!').presentClasses).toHaveLength(4)
  })

  it('recognises classes in non-Latin alphabets', () => {
    expect(assessPassword('Password12345!').presentClasses).toHaveLength(4)
  })
})

describe('assessPassword: obviously bad passwords', () => {
  it('notes a common password but does not reject it', () => {
    expect(assessPassword('Password1234').issues).toContain(PASSWORD_ISSUE.Common)
    expect(assessPassword('Password1234').isAcceptable).toBe(true)
  })

  it('finds a common fragment inside a password', () => {
    expect(assessPassword('MyPassword12!').issues).toContain(PASSWORD_ISSUE.Common)
  })

  it('notes a password made of a repeated fragment', () => {
    expect(assessPassword('Ab1!Ab1!Ab1!').issues).toContain(PASSWORD_ISSUE.Repetitive)
    expect(assessPassword('Ab1!Ab1!Ab1!').isAcceptable).toBe(true)
  })

  it('does not treat an ordinary password as repetitive', () => {
    expect(assessPassword('Korova-7-Luna!').issues).not.toContain(PASSWORD_ISSUE.Repetitive)
  })
})

describe('assessPassword: quality grade', () => {
  it('calls a password with violations weak', () => {
    expect(assessPassword('abc').strength).toBe(PASSWORD_STRENGTH.Weak)
  })

  it('calls a short password with no violations fair', () => {
    expect(assessPassword('Abcdefgh1234').strength).toBe(PASSWORD_STRENGTH.Fair)
  })

  it('calls a long password with all classes strong', () => {
    expect(assessPassword('Korova-7-Luna-Reka!').strength).toBe(PASSWORD_STRENGTH.Strong)
  })

  it('accepts a password with no violations', () => {
    expect(assessPassword('Korova-7-Luna!').isAcceptable).toBe(true)
  })
})

describe('assertAcceptablePassword', () => {
  it('lets an acceptable password through', () => {
    expect(() => {
      assertAcceptablePassword('Korova-7-Luna!')
    }).not.toThrow()
  })

  it('lets a simple password through', () => {
    expect(() => {
      assertAcceptablePassword('123456')
    }).not.toThrow()
    expect(() => {
      assertAcceptablePassword('123')
    }).not.toThrow()
  })

  it('rejects an empty password', () => {
    expect(() => {
      assertAcceptablePassword('')
    }).toThrow(WeakPasswordError)
  })

  it('does not reveal the password in the error text', () => {
    expect.assertions(1)

    try {
      assertAcceptablePassword(`secret123${'x'.repeat(300)}`)
    } catch (error) {
      expect((error as Error).message).not.toContain('secret123')
    }
  })
})
