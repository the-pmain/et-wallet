import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  mnemonicToSeedWebcrypto,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

import { SecretBuffer, getRandomBytes, wipeBytes, type ISecretBuffer } from '@/core/encryption'
import {
  InvalidArgumentError,
  InvalidMnemonicError,
  MNEMONIC_INVALID_REASON,
  type MnemonicInvalidReason,
} from '@/core/errors'

import type { IMnemonicService } from './contracts'
import { normalizeMnemonicInput, splitWords } from './normalize'
import {
  MNEMONIC_STRENGTH,
  VALID_WORD_COUNTS,
  type IMnemonicValidationResult,
  type MnemonicStrength,
} from './types'

/** Allowed entropy sizes in bytes: 128, 160, 192, 224, and 256 bits. */
const VALID_ENTROPY_LENGTHS: readonly number[] = [16, 20, 24, 28, 32]

const DEFAULT_SUGGESTION_LIMIT = 8

/**
 * Wordlist as a set.
 *
 * A Set instead of `Array.includes`: checking each of 24 words by
 * a linear search over 2048 entries runs on every keystroke while
 * the phrase is typed. Building the set once at module load is
 * cheaper.
 */
const WORDLIST_SET = new Set(wordlist)

/**
 * BIP-39 mnemonic work.
 *
 * LANGUAGE LIMIT. Only the English wordlist is supported. It is
 * hard-wired and is NOT injected: the ability to swap the wordlist
 * would be the ability to slip in a set of words whose index
 * mapping an attacker knows, and to get predictable entropy from a
 * phrase that looks "correct".
 *
 * A phrase in another language is rejected as invalid. That is a
 * limit, not a bug; it is recorded in the README.
 *
 * MEMORY LIMIT. Every call into `@scure/bip39` creates an
 * unwipeable string with the phrase. Below it lives for exactly one
 * expression everywhere, but it cannot be eliminated entirely.
 */
export class MnemonicService implements IMnemonicService {
  generate(strength: MnemonicStrength = MNEMONIC_STRENGTH.Words12): ISecretBuffer {
    if (strength !== MNEMONIC_STRENGTH.Words12 && strength !== MNEMONIC_STRENGTH.Words24) {
      throw new InvalidArgumentError('strength', 'only the values 128 and 256 are allowed')
    }

    /* Entropy is taken with our own function, not the built-in
       `generateMnemonic`, so a broken generator can be detected: a
       zero buffer from a broken polyfill must stop wallet creation,
       not yield a predictable key. */
    const entropy = getRandomBytes(strength / 8)

    try {
      return SecretBuffer.fromUtf8(entropyToMnemonic(entropy, wordlist))
    } finally {
      wipeBytes(entropy)
    }
  }

  validate(phrase: string): IMnemonicValidationResult {
    const normalized = normalizeMnemonicInput(phrase)
    const words = splitWords(normalized)

    if (words.length === 0) {
      return MnemonicService.#invalid(0, MNEMONIC_INVALID_REASON.Empty)
    }

    if (!VALID_WORD_COUNTS.includes(words.length)) {
      return MnemonicService.#invalid(words.length, MNEMONIC_INVALID_REASON.WordCount)
    }

    /* Unknown words are found before the checksum check: a typo is
       incomparably more common than a swapped order, and a hint
       about a specific word is more useful than a checksum message. */
    const unknownWordIndexes: number[] = []

    words.forEach((word, index) => {
      if (!WORDLIST_SET.has(word)) {
        unknownWordIndexes.push(index)
      }
    })

    if (unknownWordIndexes.length > 0) {
      return {
        isValid: false,
        wordCount: words.length,
        reason: MNEMONIC_INVALID_REASON.UnknownWord,
        unknownWordIndexes,
      }
    }

    if (!validateMnemonic(normalized, wordlist)) {
      return MnemonicService.#invalid(words.length, MNEMONIC_INVALID_REASON.Checksum)
    }

    return {
      isValid: true,
      wordCount: words.length,
      reason: null,
      unknownWordIndexes: [],
    }
  }

  fromPhrase(phrase: string): ISecretBuffer {
    const result = this.validate(phrase)

    if (!result.isValid) {
      /* The reason is always filled when isValid === false. The
         check is for the compiler, not the logic. */
      throw new InvalidMnemonicError(result.reason ?? MNEMONIC_INVALID_REASON.Checksum)
    }

    return SecretBuffer.fromUtf8(normalizeMnemonicInput(phrase))
  }

  revealPhrase(mnemonic: ISecretBuffer): string {
    return new TextDecoder().decode(mnemonic.bytes)
  }

  toWords(mnemonic: ISecretBuffer): readonly string[] {
    return splitWords(this.revealPhrase(mnemonic))
  }

  async toSeed(mnemonic: ISecretBuffer, passphrase = ''): Promise<ISecretBuffer> {
    const phrase = this.revealPhrase(mnemonic)

    /* Native Web Crypto PBKDF2 is preferred: it runs outside the
       JavaScript heap, leaving no intermediate HMAC states in
       objects that then cannot be wiped.

       The fallback is the @noble/hashes implementation. That is not
       a drop in strength: the algorithm and parameters are the same,
       only the place of execution differs. Needed for environments
       without crypto.subtle, in particular jsdom in tests. */
    const seed = MnemonicService.#hasWebCryptoSubtle()
      ? await mnemonicToSeedWebcrypto(phrase, passphrase)
      : await mnemonicToSeed(phrase, passphrase)

    return SecretBuffer.own(seed)
  }

  toEntropy(mnemonic: ISecretBuffer): ISecretBuffer {
    const phrase = this.revealPhrase(mnemonic)

    try {
      return SecretBuffer.own(mnemonicToEntropy(phrase, wordlist))
    } catch {
      /* The library reports the error as text that must not be
         parsed: the wording is not part of its public contract. The
         reason is recovered by our own validation. */
      const result = this.validate(phrase)

      throw new InvalidMnemonicError(result.reason ?? MNEMONIC_INVALID_REASON.Checksum)
    }
  }

  fromEntropy(entropy: Uint8Array): ISecretBuffer {
    if (!VALID_ENTROPY_LENGTHS.includes(entropy.length)) {
      throw new InvalidArgumentError(
        'entropy',
        `allowed lengths are ${VALID_ENTROPY_LENGTHS.join(', ')} bytes, received ${String(entropy.length)}`,
      )
    }

    return SecretBuffer.fromUtf8(entropyToMnemonic(entropy, wordlist))
  }

  findWordsByPrefix(prefix: string, limit: number = DEFAULT_SUGGESTION_LIMIT): readonly string[] {
    const normalized = normalizeMnemonicInput(prefix)

    if (normalized.length === 0 || limit <= 0) {
      return []
    }

    const matches: string[] = []

    for (const word of wordlist) {
      if (word.startsWith(normalized)) {
        matches.push(word)

        if (matches.length === limit) {
          break
        }
      }
    }

    return matches
  }

  static #invalid(wordCount: number, reason: MnemonicInvalidReason): IMnemonicValidationResult {
    return { isValid: false, wordCount, reason, unknownWordIndexes: [] }
  }

  static #hasWebCryptoSubtle(): boolean {
    return typeof globalThis.crypto?.subtle?.importKey === 'function'
  }
}
