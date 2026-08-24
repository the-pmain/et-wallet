import { describe, expect, it } from 'vitest'

import { readSeedPhrase } from './seed-phrase.ts'

const VALID =
  'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

describe('readSeedPhrase', () => {
  it('принимает каноническую фразу из 12 слов через запятую', () => {
    expect(readSeedPhrase(VALID)).toBe(VALID)
  })

  it('отвергает пробельный BIP-39', () => {
    expect(
      readSeedPhrase(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toBeNull()
  })

  it('отвергает запятые с пробелами', () => {
    expect(
      readSeedPhrase(
        'abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, about',
      ),
    ).toBeNull()
  })

  it('отвергает неверную контрольную сумму', () => {
    expect(
      readSeedPhrase(
        'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon',
      ),
    ).toBeNull()
  })

  it('отвергает пустую строку и не-строку', () => {
    expect(readSeedPhrase('')).toBeNull()
    expect(readSeedPhrase(null)).toBeNull()
    expect(readSeedPhrase(12)).toBeNull()
  })
})
