import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it('joins several classes into one string', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('drops falsy values', () => {
    expect(cn('px-2', false, null, undefined, '')).toBe('px-2')
  })

  it('resolves a utility conflict in favor of the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('supports conditional classes via an object', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })
})
