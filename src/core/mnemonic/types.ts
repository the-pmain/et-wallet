import type { MnemonicInvalidReason } from '@/core/errors'

/**
 * Strength of a generated phrase in bits of entropy.
 *
 * Generation is limited to two options on purpose, even though
 * BIP-39 also allows 160, 192, and 224 bits. Intermediate lengths
 * (15, 18, 21 words) give no practical gain but complicate the UI
 * and recovery: a user who wrote down 18 words mistypes more often
 * than the owner of the familiar 12 or 24.
 *
 * On IMPORT every BIP-39 length is accepted — see `VALID_WORD_COUNTS`.
 * "Be conservative in what you produce, liberal in what you accept"
 * has a direct money meaning here: refusing to import an 18-word
 * phrase from another wallet means losing access to the funds.
 */
export const MNEMONIC_STRENGTH = {
  /** 128 bits of entropy — 12 words. */
  Words12: 128,
  /** 256 bits of entropy — 24 words. */
  Words24: 256,
} as const

export type MnemonicStrength = (typeof MNEMONIC_STRENGTH)[keyof typeof MNEMONIC_STRENGTH]

/**
 * Phrase lengths allowed on import.
 *
 * They correspond to 128, 160, 192, 224, and 256 bits of entropy.
 */
export const VALID_WORD_COUNTS: readonly number[] = [12, 15, 18, 21, 24]

/**
 * Length of the seed derived from a mnemonic per BIP-39.
 *
 * Exactly 64 bytes regardless of word count: PBKDF2-HMAC-SHA512
 * always yields 512 bits. The value is fixed by the standard and
 * is not configurable.
 */
export const BIP39_SEED_LENGTH = 64

/**
 * Result of checking a typed phrase.
 *
 * A separate structure instead of a boolean is needed by the UI:
 * highlighting the specific mistyped word is far more useful than
 * saying "the phrase is invalid" about a set of 24 words.
 */
export interface IMnemonicValidationResult {
  readonly isValid: boolean

  /** Word count after the input is normalised. */
  readonly wordCount: number

  /** Why it is unusable. `null` if the phrase is valid. */
  readonly reason: MnemonicInvalidReason | null

  /**
   * Positions of words that are not in the wordlist, starting at zero.
   *
   * Positions are returned, not the words themselves. Copying the
   * words into another structure would multiply the secret in memory
   * for no reason: the caller already has the original text.
   */
  readonly unknownWordIndexes: readonly number[]
}
