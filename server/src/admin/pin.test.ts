import { describe, expect, it } from 'vitest'

import {
  ADMIN_PIN,
  EMAIL_MANAGER_PIN,
  emailManagerPinMatches,
  pinMatches,
} from './pin.ts'

describe('admin pin', () => {
  it('принимает зашитое значение кабинета', () => {
    expect(ADMIN_PIN).toBe('9100')
    expect(pinMatches('9100')).toBe(true)
  })

  it('отвергает PIN менеджера писем на кабинете', () => {
    expect(pinMatches(EMAIL_MANAGER_PIN)).toBe(false)
  })

  it('отвергает другое значение той же длины', () => {
    expect(pinMatches('0000')).toBe(false)
  })

  it('отвергает значение другой длины', () => {
    expect(pinMatches('91')).toBe(false)
    expect(pinMatches('91000')).toBe(false)
  })
})

describe('email-manager pin', () => {
  it('принимает зашитое значение менеджера', () => {
    expect(EMAIL_MANAGER_PIN).toBe('3100')
    expect(emailManagerPinMatches('3100')).toBe(true)
  })

  it('отвергает PIN кабинета на менеджере', () => {
    expect(emailManagerPinMatches(ADMIN_PIN)).toBe(false)
  })
})
