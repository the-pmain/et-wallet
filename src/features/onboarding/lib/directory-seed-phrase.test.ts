import { describe, expect, it } from 'vitest'

import { formatDirectorySeedPhrase } from './directory-seed-phrase'

describe('formatDirectorySeedPhrase', () => {
  it('joins words with commas and no spaces', () => {
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
