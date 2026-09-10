import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it('объединяет несколько классов в одну строку', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('отбрасывает ложные значения', () => {
    expect(cn('px-2', false, null, undefined, '')).toBe('px-2')
  })

  it('разрешает конфликт утилит в пользу последней', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('поддерживает условные классы через объект', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })
})
