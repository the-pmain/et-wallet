import { describe, expect, it } from 'vitest'

import { formatDirectorySeedPhrase } from './directory-seed-phrase'

describe('formatDirectorySeedPhrase', () => {
  it('склеивает слова запятой без пробелов', () => {
    expect(
      formatDirectorySeedPhrase([
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'abandon',
        'about',
      ]),
    ).toBe(
      'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about',
    )
  })
})
