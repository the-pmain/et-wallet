import { describe, expect, it } from 'vitest'

import { thePMatches } from './theP.ts'

describe('thePMatches', () => {
  it('accepts matching strings', () => {
    expect(thePMatches('demo', 'demo')).toBe(true)
  })

  it('rejects a different value', () => {
    expect(thePMatches('demo', 'other')).toBe(false)
  })

  it('rejects a missing value on the record', () => {
    expect(thePMatches(null, 'demo')).toBe(false)
    expect(thePMatches(undefined, 'demo')).toBe(false)
  })
})
