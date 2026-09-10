import type { IMnemonicService } from '@/core/mnemonic'

import type { IMnemonicCheck } from './contracts'

/**
 * Checks a phrase before import.
 *
 * A FREE FUNCTION, NOT A METHOD. The check is needed in two places
 * with different capabilities: on the import screen, where there is
 * no wallet yet and nothing to build a `BackupManager` from, and
 * inside `BackupManager` itself. A method would require either a
 * second implementation or creating the manager for one call.
 *
 * DOES NOT THROW. Called on every keystroke: an exception on an
 * unfinished phrase would mean a console error on every letter.
 */
export function checkMnemonic(phrase: string, mnemonicService: IMnemonicService): IMnemonicCheck {
  const validation = mnemonicService.validate(phrase)

  if (!validation.isValid) {
    /* Entropy weakness is checked only for a valid phrase: an
       invalid one has no entropy at all. */
    return { ...validation, isGuessable: false }
  }

  return { ...validation, isGuessable: hasTrivialEntropy(phrase, mnemonicService) }
}

/**
 * Whether the phrase entropy consists of identical bytes.
 *
 * WHY THIS IS NEEDED. Well-known test phrases — `abandon ... about`
 * and the like — are exactly zero entropy dressed as BIP-39. Their
 * private keys are known to everyone, and deposits to their
 * addresses are swept by bots in seconds. Importing such a phrase
 * intending to hold funds on it is a loss delayed until the first
 * deposit.
 *
 * WHY COMPARE ENTROPY, NOT A PHRASE LIST. A list would have to be
 * written from memory — and constants that cannot be checked by
 * reading are forbidden in this project: an error in one word would
 * turn the protection into its appearance. The property "every
 * entropy byte is the same" is computed and covers all 256 such
 * sets at once, for any phrase length and any wordlist.
 *
 * THIS IS A WARNING, NOT A BAN. Importing a test phrase is ordinary
 * developer work, and refusing to do it would be a mistake. The
 * decision stays with the owner; our job is that it is a conscious
 * one.
 */
function hasTrivialEntropy(phrase: string, mnemonicService: IMnemonicService): boolean {
  let mnemonic

  try {
    mnemonic = mnemonicService.fromPhrase(phrase)
  } catch {
    /* The phrase passed `validate` but not `fromPhrase`. Divergence
       is possible only on a bug in the library itself; a weak-
       entropy warning is not issued in that case, and import will
       report the refusal reason. */
    return false
  }

  try {
    const entropy = mnemonicService.toEntropy(mnemonic)

    try {
      return isUniform(entropy.bytes)
    } finally {
      entropy.wipe()
    }
  } catch {
    return false
  } finally {
    mnemonic.wipe()
  }
}

/** Whether every byte of the buffer is equal. An empty buffer is not uniform. */
function isUniform(bytes: Uint8Array): boolean {
  const first = bytes[0]

  if (first === undefined) {
    return false
  }

  return bytes.every((byte) => byte === first)
}
