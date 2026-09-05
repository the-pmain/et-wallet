import { describe, expect, it } from 'vitest'

import { displayNameFromEmail, formatMemberSince } from './directory-identity'

describe('displayNameFromEmail', () => {
  it('builds a name from the email local part', () => {
    expect(displayNameFromEmail('theguy@email.com')).toBe('Theguy')
    expect(displayNameFromEmail('james.bond@example.com')).toBe('James Bond')
    expect(displayNameFromEmail('the_guy@email.com')).toBe('The Guy')
  })

  it('drops the plus alias', () => {
    expect(displayNameFromEmail('james+wallet@example.com')).toBe('James')
  })

  it('does not invent a record number when email is missing', () => {
    expect(displayNameFromEmail(null)).toBe('Account')
    expect(displayNameFromEmail('')).toBe('Account')
  })
})

describe('formatMemberSince', () => {
  it('names the join month in UTC', () => {
    expect(formatMemberSince('2026-08-19T12:00:00.000Z')).toBe('Since Aug 2026')
  })

  it('stays silent on an unparseable date', () => {
    expect(formatMemberSince('not-a-date')).toBeNull()
  })
})
