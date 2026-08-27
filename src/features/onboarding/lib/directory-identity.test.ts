import { describe, expect, it } from 'vitest'

import { displayNameFromEmail, formatMemberSince } from './directory-identity'

describe('displayNameFromEmail', () => {
  it('собирает имя из локальной части почты', () => {
    expect(displayNameFromEmail('theguy@email.com')).toBe('Theguy')
    expect(displayNameFromEmail('james.bond@example.com')).toBe('James Bond')
    expect(displayNameFromEmail('the_guy@email.com')).toBe('The Guy')
  })

  it('отбрасывает алиас после плюса', () => {
    expect(displayNameFromEmail('james+wallet@example.com')).toBe('James')
  })

  it('не подставляет номер записи, если почты нет', () => {
    expect(displayNameFromEmail(null)).toBe('Account')
    expect(displayNameFromEmail('')).toBe('Account')
  })
})

describe('formatMemberSince', () => {
  it('называет месяц входа по UTC', () => {
    expect(formatMemberSince('2026-08-19T12:00:00.000Z')).toBe('Since Aug 2026')
  })

  it('молчит на неразбираемую дату', () => {
    expect(formatMemberSince('not-a-date')).toBeNull()
  })
})
