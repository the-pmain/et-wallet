import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/**
 * Allowed BIP-39 lengths: 128–256 bits of entropy.
 *
 * Wallet create yields 12 words; import may bring any standard length.
 * Rejecting 15/18/21 words would cut off someone else's phrase.
 */
const VALID_WORD_COUNTS: ReadonlySet<number> = new Set([12, 15, 18, 21, 24])

/**
 * Canonical `seed_phrase` column form.
 *
 * Words comma-separated, no spaces: `word1,word2,…,word12`.
 * Space-separated BIP-39 and `word1, word2` are rejected.
 */
const COMMA_PHRASE = /^[a-z]+(?:,[a-z]+)+$/u

/**
 * Checks `seed_phrase` from the user-create body.
 *
 * `null` — empty, wrong format, not in the BIP-39 wordlist, or bad
 * checksum. One outbound message: the phrase is unfit. The reason
 * need not be distinguished.
 */
export function readSeedPhrase(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const phrase = value.trim()

  if (!COMMA_PHRASE.test(phrase)) {
    return null
  }

  const words = phrase.split(',')

  if (!VALID_WORD_COUNTS.has(words.length)) {
    return null
  }

  if (!validateMnemonic(words.join(' '), wordlist)) {
    return null
  }

  return words.join(',')
}
