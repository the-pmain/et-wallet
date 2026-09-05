import { describe, expect, it } from 'vitest'

import { readSeedPhrase } from './seed-phrase.ts'

const VALID =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

describe('readSeedPhrase', () => {
  it('accepts a canonical 12-word comma-separated phrase', () => {
    expect(readSeedPhrase(VALID)).toBe(VALID)
  })

  it('rejects space-separated BIP-39', () => {
    expect(
      readSeedPhrase(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toBeNull()
  })

  it('rejects commas with spaces', () => {
    expect(
      readSeedPhrase(
        'abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, about',
      ),
    ).toBeNull()
  })

  it('rejects a bad checksum', () => {
    expect(
      readSeedPhrase(
        'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon',
      ),
    ).toBeNull()
  })

  it('rejects an empty string and a non-string', () => {
    expect(readSeedPhrase('')).toBeNull()
    expect(readSeedPhrase(null)).toBeNull()
    expect(readSeedPhrase(12)).toBeNull()
  })
})
