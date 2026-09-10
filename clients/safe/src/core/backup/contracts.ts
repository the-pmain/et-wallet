import type { ISecretBuffer } from '@/core/encryption'
import type { IMnemonicValidationResult } from '@/core/mnemonic'
import type { ExportRisk, IExportRiskAssessment } from '@/core/security'
import type { AccountId } from '@/core/types'

/**
 * Check of a mnemonic phrase before import.
 *
 * WHAT IS CHECKED AND WHAT IS NOT. The phrase is checked for
 * validity: allowed length, every word in the wordlist, checksum
 * matches — and that its entropy is not trivial. It is not checked,
 * and cannot be checked, that the phrase belongs to the user: the
 * wallet will restore any valid phrase, including someone else's
 * and including one that was planted.
 *
 * EXTENDS THE VALIDATION RESULT, DOES NOT REPEAT IT. Positions of
 * unknown words, word count, and the machine-readable refusal
 * reason are already described in {@link IMnemonicValidationResult};
 * a second structure with the same fields would drift from the first
 * at the next change.
 */
export interface IMnemonicCheck extends IMnemonicValidationResult {
  /**
   * The phrase entropy consists of identical bytes.
   *
   * A marker of a well-known test set such as `abandon … about`.
   * Funds on the addresses of such a phrase belong to no one: anyone
   * can compute its private keys.
   *
   * Not a reason to refuse: importing a test phrase is ordinary
   * developer work. The UI must show a warning and leave the
   * decision to the owner.
   */
  readonly isGuessable: boolean
}

/**
 * Backup of wallet secrets.
 *
 * THIS INTERFACE IS THE MOST DANGEROUS PART OF THE WALLET. Everything
 * else is built on secrets never leaving encrypted storage; here they
 * leave it on request. Encryption, auto-lock, and log redaction are
 * bypassed by one successful call from here.
 *
 * HENCE THREE RULES, MANDATORY FOR EVERY REVEAL METHOD:
 *
 * 1. The password is checked again even if the wallet is unlocked.
 *    An unlocked lock means the password was entered at some point,
 *    not that the owner is at the device now.
 * 2. An `ExportGuard` permit is required, issued for the risk level
 *    shown to the user. The warning cannot be understated: the
 *    permit will not be issued.
 * 3. The secret is returned as a buffer the caller must wipe. A
 *    JavaScript string cannot be wiped — it lives until garbage
 *    collection — so a buffer is what goes out.
 *
 * WHAT IS NOT HERE AND WHY. Wallet import: it creates a wallet, and
 * wallet creation is done by onboarding. A second creation path would
 * be a second place that decides what to do with an already existing
 * wallet — and a second way to overwrite it.
 */
export interface IBackupManager {
  /**
   * Assesses the risk of revealing the mnemonic phrase.
   *
   * Called before the warning is shown: the UI must show text that
   * matches the returned level, or the permit will not be issued.
   */
  assessMnemonicExport(): Promise<IExportRiskAssessment>

  /**
   * Reveals the mnemonic phrase.
   *
   * @param password Wallet password. Checked again.
   * @param acknowledgedRisk Risk level shown to the user.
   * @throws InvalidPasswordError, ExportNotPermittedError,
   *         WalletNotInitializedError
   */
  exportMnemonic(password: string, acknowledgedRisk: ExportRisk): Promise<ISecretBuffer>

  /**
   * Assesses the risk of revealing a specific account's private key.
   *
   * @throws AccountNotFoundError
   */
  assessPrivateKeyExport(id: AccountId): Promise<IExportRiskAssessment>

  /**
   * Reveals an account private key.
   *
   * @throws InvalidPasswordError, ExportNotPermittedError,
   *         AccountNotFoundError
   */
  exportPrivateKey(
    id: AccountId,
    password: string,
    acknowledgedRisk: ExportRisk,
  ): Promise<ISecretBuffer>

  /**
   * Checks a rewritten phrase against the stored one without showing
   * the stored one.
   *
   * Answers with a single bit: pointing at the differing word would
   * help more than the owner. The password is required — without it
   * the method becomes an oracle for guessing someone else's phrase.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  verifyMnemonicBackup(phrase: string, password: string): Promise<boolean>

  /**
   * Checks a phrase before import.
   *
   * Does not throw: the input form calls this on every keystroke, and
   * an exception on an unfinished phrase would mean a console error
   * on every letter.
   */
  checkMnemonic(phrase: string): IMnemonicCheck
}
