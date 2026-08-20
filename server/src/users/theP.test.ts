import { describe, expect, it } from 'vitest'

import { thePMatches } from './theP.ts'

describe('thePMatches', () => {
  it('принимает совпадающие строки', () => {
    expect(thePMatches('demo', 'demo')).toBe(true)
  })

  it('отвергает другое значение', () => {
    expect(thePMatches('demo', 'other')).toBe(false)
  })

  it('отвергает отсутствие значения в записи', () => {
    expect(thePMatches(null, 'demo')).toBe(false)
    expect(thePMatches(undefined, 'demo')).toBe(false)
  })
})
