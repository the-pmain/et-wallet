import type { ISecretBuffer } from '@/core/encryption'

import type { IMnemonicValidationResult, MnemonicStrength } from './types'

/**
 * Work with BIP-39 mnemonic phrases.
 *
 * The service holds no state. Storing the encrypted phrase is
 * `IWallet`'s job; here there are only conversions and checks. That
 * lets the service be called from the create-wallet form without
 * creating an intermediate secret owner that would then have to be
 * wiped separately.
 *
 * BOUNDARY OF GUARANTEES, IMPORTANT FOR EVERY CALLER.
 *
 * `@scure/bip39` works with strings: the phrase inevitably exists
 * on the heap as an unwipeable string for the duration of the call.
 * The only way around that is a home-grown BIP-39, which is
 * forbidden. The methods below shrink the string's lifetime to one
 * expression, but they do not eliminate it.
 *
 * Every method that returns an `ISecretBuffer` transfers ownership
 * to the caller: they must call `wipe()` in a `finally` block.
 */
export interface IMnemonicService {
  /**
   * Creates a new phrase.
   *
   * Entropy comes exclusively from `crypto.getRandomValues`. The
   * source is not swappable: the ability to replace the RNG is the
   * ability to make every key predictable.
   *
   * @param strength 128 bits (12 words) or 256 bits (24 words).
   * @returns The phrase in UTF-8. Ownership passes to the caller.
   * @throws RandomnessUnavailableError if Web Crypto is unavailable
   *         or the generator returned a known-bad result.
   */
  generate(strength?: MnemonicStrength): ISecretBuffer

  /**
   * Checks a typed phrase without throwing.
   *
   * Meant for checking as the user types: they must not see an
   * error before they have finished typing. For import use
   * {@link IMnemonicService.fromPhrase}.
   */
  validate(phrase: string): IMnemonicValidationResult

  /**
   * Imports an existing phrase.
   *
   * The input is normalised: NFKD, removal of invisible characters,
   * collapsing whitespace, lower case. Every BIP-39 length is
   * accepted (12, 15, 18, 21, 24 words), not only those the app
   * generates.
   *
   * @returns The normalised phrase. Ownership passes to the caller.
   * @throws InvalidMnemonicError with the reason in the `reason` field.
   */
  fromPhrase(phrase: string): ISecretBuffer

  /**
   * Reveals the phrase as a string.
   *
   * A DANGEROUS OPERATION. The returned string is unwipeable and
   * stays on the heap until garbage collection. Call only where a
   * string is actually needed: copying to the clipboard, display
   * when creating a wallet. To show the phrase word by word use
   * {@link IMnemonicService.toWords}.
   *
   * @throws SecretBufferWipedError if the buffer is already wiped.
   */
  revealPhrase(mnemonic: ISecretBuffer): string

  /**
   * Reveals the phrase as a list of words — for numbered display.
   *
   * As dangerous as {@link IMnemonicService.revealPhrase}: the words
   * stay on the heap as unwipeable strings.
   */
  toWords(mnemonic: ISecretBuffer): readonly string[]

  /**
   * Derives the binary seed per BIP-39.
   *
   * This is the value that becomes the HD-tree root on the next
   * step. The conversion is irreversible: the phrase cannot be
   * recovered from the seed.
   *
   * @param passphrase Optional extra passphrase ("25th word").
   *        Changes the seed entirely: the same mnemonic with a
   *        different passphrase yields a completely different
   *        wallet. Losing the passphrase is equivalent to losing
   *        the seed phrase — recovery is impossible.
   * @returns 64 bytes. Ownership passes to the caller.
   */
  toSeed(mnemonic: ISecretBuffer, passphrase?: string): Promise<ISecretBuffer>

  /**
   * Extracts the original entropy.
   *
   * A reversible operation: {@link IMnemonicService.fromEntropy}
   * will restore the same phrase. Needed for compact backups and
   * for checking the checksum.
   *
   * @throws InvalidMnemonicError
   */
  toEntropy(mnemonic: ISecretBuffer): ISecretBuffer

  /**
   * Restores a phrase from entropy.
   *
   * @param entropy 16, 20, 24, 28, or 32 bytes.
   * @throws InvalidArgumentError on an illegal length.
   */
  fromEntropy(entropy: Uint8Array): ISecretBuffer

  /**
   * Wordlist words that start with the given prefix.
   *
   * Needed for autocomplete while typing. A typo in a word is a
   * real way to lose access to funds, and a suggestion lowers that
   * chance.
   *
   * Creates no leak: the BIP-39 wordlist is public, suggestions are
   * built locally and sent nowhere.
   */
  findWordsByPrefix(prefix: string, limit?: number): readonly string[]
}
