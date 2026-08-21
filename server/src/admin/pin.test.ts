import { describe, expect, it } from 'vitest'

import { ADMIN_PIN, pinMatches } from './pin.ts'

describe('admin pin', () => {
  it('принимает зашитое значение', () => {
    expect(ADMIN_PIN).toBe('9100')
    expect(pinMatches('9100')).toBe(true)
  })

  it('отвергает другое значение той же длины', () => {
    expect(pinMatches('0000')).toBe(false)
  })

  it('отвергает значение другой длины', () => {
    expect(pinMatches('91')).toBe(false)
    expect(pinMatches('91000')).toBe(false)
  })
})
