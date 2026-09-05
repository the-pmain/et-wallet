import { beforeEach, describe, expect, it } from 'vitest'

import { SecretBuffer } from '@/core/encryption'
import {
  InvalidArgumentError,
  InvalidMnemonicError,
  MNEMONIC_INVALID_REASON,
  SecretBufferWipedError,
} from '@/core/errors'

import { MnemonicService } from './MnemonicService'
import { MNEMONIC_STRENGTH, VALID_WORD_COUNTS } from './types'
import { BIP39_VECTORS, TREZOR_PASSPHRASE, bytesToHex, hexToBytes } from './vectors'

const VALID_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const VALID_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

let service: MnemonicService

beforeEach(() => {
  service = new MnemonicService()
})

describe('MnemonicService: official BIP-39 vectors', () => {
  it.each(BIP39_VECTORS)('entropy $entropy yields the expected phrase', ({ entropy, mnemonic }) => {
    const buffer = service.fromEntropy(hexToBytes(entropy))

    try {
      expect(service.revealPhrase(buffer)).toBe(mnemonic)
    } finally {
      buffer.wipe()
    }
  })

  it.each(BIP39_VECTORS)(
    'the phrase for $entropy restores the original entropy',
    ({ entropy, mnemonic }) => {
      const buffer = service.fromPhrase(mnemonic)
      const recovered = service.toEntropy(buffer)

      try {
        expect(bytesToHex(recovered.bytes)).toBe(entropy)
      } finally {
        recovered.wipe()
        buffer.wipe()
      }
    },
  )

  it.each(BIP39_VECTORS.filter((vector) => vector.seed !== null))(
    'the seed for $entropy matches the reference',
    async ({ mnemonic, seed }) => {
      const buffer = service.fromPhrase(mnemonic)
      const derived = await service.toSeed(buffer, TREZOR_PASSPHRASE)

      try {
        expect(bytesToHex(derived.bytes)).toBe(seed)
      } finally {
        derived.wipe()
        buffer.wipe()
      }
    },
  )
})

describe('MnemonicService: generation', () => {
  it('creates 12 words by default', () => {
    const buffer = service.generate()

    try {
      expect(service.toWords(buffer)).toHaveLength(12)
    } finally {
      buffer.wipe()
    }
  })

  it('creates 24 words at 256-bit strength', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      expect(service.toWords(buffer)).toHaveLength(24)
    } finally {
      buffer.wipe()
    }
  })

  it('creates a phrase that passes its own validation', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      expect(service.validate(service.revealPhrase(buffer)).isValid).toBe(true)
    } finally {
      buffer.wipe()
    }
  })

  it('creates a different phrase on every call', () => {
    const first = service.generate()
    const second = service.generate()

    try {
      expect(service.revealPhrase(first)).not.toBe(service.revealPhrase(second))
    } finally {
      first.wipe()
      second.wipe()
    }
  })

  it('rejects an illegal strength', () => {
    expect(() => service.generate(192 as never)).toThrow(InvalidArgumentError)
  })

  it('uses only wordlist words', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      for (const word of service.toWords(buffer)) {
        expect(service.findWordsByPrefix(word, 1)).toContain(word)
      }
    } finally {
      buffer.wipe()
    }
  })
})

describe('MnemonicService: validation', () => {
  it('accepts a valid 12-word phrase', () => {
    expect(service.validate(VALID_12)).toEqual({
      isValid: true,
      wordCount: 12,
      reason: null,
      unknownWordIndexes: [],
    })
  })

  it('accepts a valid 24-word phrase', () => {
    expect(service.validate(VALID_24).isValid).toBe(true)
  })

  it.each(VALID_WORD_COUNTS)('accepts a length of %i words', (count) => {
    /* BIP-39: every three words encode 32 bits of entropy,
       i.e. 4 bytes. Hence 12 words -> 16 bytes, 24 words -> 32 bytes. */
    const entropyBytes = (count * 4) / 3
    const buffer = service.fromEntropy(new Uint8Array(entropyBytes).fill(1))

    try {
      expect(service.validate(service.revealPhrase(buffer)).wordCount).toBe(count)
    } finally {
      buffer.wipe()
    }
  })

  it('rejects empty input', () => {
    expect(service.validate('')).toMatchObject({
      isValid: false,
      reason: MNEMONIC_INVALID_REASON.Empty,
    })
  })

  it('rejects input of only whitespace', () => {
    expect(service.validate('   \n\t  ').reason).toBe(MNEMONIC_INVALID_REASON.Empty)
  })

  it('rejects an illegal word count', () => {
    expect(service.validate('abandon abandon about')).toMatchObject({
      isValid: false,
      wordCount: 3,
      reason: MNEMONIC_INVALID_REASON.WordCount,
    })
  })

  it('rejects 13 words', () => {
    expect(service.validate(`${VALID_12} about`).reason).toBe(MNEMONIC_INVALID_REASON.WordCount)
  })

  it('reports positions of words outside the wordlist', () => {
    const phrase = VALID_12.replace(
      'abandon abandon abandon abandon',
      'abandon xyzzy abandon qwerty',
    )

    expect(service.validate(phrase)).toMatchObject({
      isValid: false,
      reason: MNEMONIC_INVALID_REASON.UnknownWord,
      unknownWordIndexes: [1, 3],
    })
  })

  it('does not reveal the wrong words themselves, only positions', () => {
    const result = service.validate(VALID_12.replace('about', 'xyzzy'))

    expect(JSON.stringify(result)).not.toContain('xyzzy')
  })

  it('rejects a phrase with a wrong checksum', () => {
    /* Every word is in the wordlist, but the last does not match the checksum. */
    const phrase = VALID_12.replace(/about$/, 'abandon')

    expect(service.validate(phrase)).toMatchObject({
      isValid: false,
      wordCount: 12,
      reason: MNEMONIC_INVALID_REASON.Checksum,
      unknownWordIndexes: [],
    })
  })

  it('rejects swapped words of a valid phrase', () => {
    const words = [...VALID_24.split(' ')]
    const [first] = words
    words[0] = words[23] as string
    words[23] = first as string

    expect(service.validate(words.join(' ')).isValid).toBe(false)
  })
})

describe('MnemonicService: input normalisation', () => {
  it('ignores leading and trailing spaces', () => {
    expect(service.validate(`   ${VALID_12}   `).isValid).toBe(true)
  })

  it('collapses repeated spaces', () => {
    expect(service.validate(VALID_12.replace(/ /g, '   ')).isValid).toBe(true)
  })

  it('accepts a newline as a separator', () => {
    expect(service.validate(VALID_12.replace(/ /g, '\n')).isValid).toBe(true)
  })

  it('forces upper case to lower case', () => {
    expect(service.validate(VALID_12.toUpperCase()).isValid).toBe(true)
  })

  it('removes non-breaking spaces from copied text', () => {
    expect(service.validate(VALID_12.replace(/ /g, ' ')).isValid).toBe(true)
  })

  it('removes ideographic spaces', () => {
    expect(service.validate(VALID_12.replace(/ /g, '\u3000')).isValid).toBe(true)
  })

  it('removes zero-width characters and BOM', () => {
    expect(service.validate(`\u200B${VALID_12}\uFEFF`).isValid).toBe(true)
  })

  it('removes soft hyphens from copied text', () => {
    expect(service.validate(`aban\u00ADdon${VALID_12.slice(7)}`).isValid).toBe(true)
  })

  it('keeps the normalised form on import', () => {
    const buffer = service.fromPhrase(`  ${VALID_12.toUpperCase()}  `)

    try {
      expect(service.revealPhrase(buffer)).toBe(VALID_12)
    } finally {
      buffer.wipe()
    }
  })
})

describe('MnemonicService: import', () => {
  it('imports a valid phrase', () => {
    const buffer = service.fromPhrase(VALID_12)

    try {
      expect(buffer.isWiped).toBe(false)
      expect(service.toWords(buffer)).toHaveLength(12)
    } finally {
      buffer.wipe()
    }
  })

  it('reports the failure reason in the reason field', () => {
    expect.assertions(2)

    try {
      service.fromPhrase('abandon abandon about')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMnemonicError)
      expect((error as InvalidMnemonicError).reason).toBe(MNEMONIC_INVALID_REASON.WordCount)
    }
  })

  it('does not reveal the phrase in the error text', () => {
    expect.assertions(1)

    try {
      service.fromPhrase(VALID_12.replace(/about$/, 'abandon'))
    } catch (error) {
      expect((error as Error).message).not.toContain('abandon')
    }
  })
})

describe('MnemonicService: export and entropy', () => {
  it('reveals the phrase as a list of words', () => {
    const buffer = service.fromPhrase(VALID_12)

    try {
      const words = service.toWords(buffer)

      expect(words).toHaveLength(12)
      expect(words[11]).toBe('about')
    } finally {
      buffer.wipe()
    }
  })

  it('is reversible: entropy -> phrase -> entropy', () => {
    const original = new Uint8Array(32)
    original.set([1, 2, 3, 4, 5])

    const buffer = service.fromEntropy(original)
    const recovered = service.toEntropy(buffer)

    try {
      expect(bytesToHex(recovered.bytes)).toBe(bytesToHex(original))
    } finally {
      recovered.wipe()
      buffer.wipe()
    }
  })

  it('rejects entropy of an illegal length', () => {
    expect(() => service.fromEntropy(new Uint8Array(17))).toThrow(InvalidArgumentError)
  })

  it('rejects empty entropy', () => {
    expect(() => service.fromEntropy(new Uint8Array(0))).toThrow(InvalidArgumentError)
  })

  it('refuses to extract entropy from a damaged phrase', () => {
    const broken = SecretBuffer.fromUtf8(VALID_12.replace(/about$/, 'abandon'))

    try {
      expect(() => service.toEntropy(broken)).toThrow(InvalidMnemonicError)
    } finally {
      broken.wipe()
    }
  })
})

describe('MnemonicService: seed derivation', () => {
  it('yields exactly 64 bytes', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const seed = await service.toSeed(buffer)

    try {
      expect(seed.bytes).toHaveLength(64)
    } finally {
      seed.wipe()
      buffer.wipe()
    }
  })

  it('is deterministic for the same phrase', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const first = await service.toSeed(buffer)
    const second = await service.toSeed(buffer)

    try {
      expect(bytesToHex(first.bytes)).toBe(bytesToHex(second.bytes))
    } finally {
      first.wipe()
      second.wipe()
      buffer.wipe()
    }
  })

  it('a passphrase changes the seed entirely', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const withoutPassphrase = await service.toSeed(buffer)
    const withPassphrase = await service.toSeed(buffer, 'additional password')

    try {
      expect(bytesToHex(withoutPassphrase.bytes)).not.toBe(bytesToHex(withPassphrase.bytes))
    } finally {
      withoutPassphrase.wipe()
      withPassphrase.wipe()
      buffer.wipe()
    }
  })

  it('treats an empty and a missing passphrase as the same', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const implicit = await service.toSeed(buffer)
    const explicit = await service.toSeed(buffer, '')

    try {
      expect(bytesToHex(implicit.bytes)).toBe(bytesToHex(explicit.bytes))
    } finally {
      implicit.wipe()
      explicit.wipe()
      buffer.wipe()
    }
  })

  it('refuses to work with a wiped buffer', async () => {
    const buffer = service.fromPhrase(VALID_12)
    buffer.wipe()

    await expect(service.toSeed(buffer)).rejects.toThrow(SecretBufferWipedError)
  })
})

describe('MnemonicService: typing suggestions', () => {
  it('finds words by prefix', () => {
    expect(service.findWordsByPrefix('aban')).toContain('abandon')
  })

  it('caps the number of suggestions', () => {
    expect(service.findWordsByPrefix('a', 3)).toHaveLength(3)
  })

  it('returns an empty list for an empty prefix', () => {
    expect(service.findWordsByPrefix('')).toEqual([])
  })

  it('returns an empty list for a nonexistent prefix', () => {
    expect(service.findWordsByPrefix('qwertyuiop')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(service.findWordsByPrefix('ABAN')).toContain('abandon')
  })

  it('returns an empty list at a zero limit', () => {
    expect(service.findWordsByPrefix('aban', 0)).toEqual([])
  })
})
