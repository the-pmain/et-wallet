import { describe, expect, it } from 'vitest'

import { ADMIN_PIN, pinMatches } from './pin.ts'

describe('admin pin', () => {
  it('принимает зашитое значение', () => {
    expect(ADMIN_PIN).toBe('3100')
    expect(pinMatches('3100')).toBe(true)
  })

  it('отвергает другое значение той же длины', () => {
    expect(pinMatches('0000')).toBe(false)
  })

  it('отвергает значение другой длины', () => {
    expect(pinMatches('31')).toBe(false)
    expect(pinMatches('31000')).toBe(false)
  })
})
