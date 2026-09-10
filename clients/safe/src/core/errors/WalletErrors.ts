import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * Wallet lifecycle, access, and key-handling errors.
 *
 * Common rule for every class below: the message contains neither the
 * entered password, nor mnemonic fragments, nor a private key. Even
 * part of a secret in an error text means it lands in the log and in
 * a crash report.
 */

export class WalletLockedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletLocked

  constructor(operation: string) {
    super(`The operation "${operation}" is unavailable: the wallet is locked.`)
  }
}

export class WalletNotInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletNotInitialized

  constructor() {
    super('The wallet has not been initialised.')
  }
}

export class WalletAlreadyInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletAlreadyInitialized

  constructor() {
    super('The wallet is already initialised. An explicit reset is required.')
  }
}

/**
 * Wrong password.
 *
 * The message deliberately does not say what failed to match.
 * Distinguishing "wrong password" from "vault corrupted" is
 * information for a password-guesser, not for the user.
 */
export class InvalidPasswordError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPassword

  constructor() {
    super('Wrong password.')
  }
}

/**
 * Too many password attempts: input is temporarily closed.
 *
 * A SEPARATE ERROR, NOT "WRONG PASSWORD". The difference is visible
 * without it — the form stopped accepting input — and hiding it leaves
 * the owner wondering why the correct password does not work. A
 * guesser gains nothing: they already hit the delay.
 */
export class TooManyAttemptsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TooManyAttempts

  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Too many attempts. Try again in ${String(Math.ceil(retryAfterMs / 1000))} s.`)
    this.retryAfterMs = retryAfterMs
  }
}

export class WeakPasswordError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WeakPassword

  constructor(reason: string) {
    super(`The password does not meet the requirements: ${reason}`)
  }
}

/**
 * Why a mnemonic is invalid.
 *
 * Distinguishing is required for the UI: "a typo in a word" and
 * "checksum does not match" need different user actions. A single
 * "phrase is invalid" leaves them with 24 words and no hint where to
 * look — and the cost of an unsolved problem here is losing access
 * to the funds.
 */
export const MNEMONIC_INVALID_REASON = {
  Empty: 'empty',
  /** Word count is not in {12, 15, 18, 21, 24}. */
  WordCount: 'word-count',
  /** One or more words are missing from the BIP-39 word list. */
  UnknownWord: 'unknown-word',
  /**
   * The words are valid, but the checksum does not match.
   * Almost always means the word order was mixed up.
   */
  Checksum: 'checksum',
} as const

export type MnemonicInvalidReason =
  (typeof MNEMONIC_INVALID_REASON)[keyof typeof MNEMONIC_INVALID_REASON]

const MNEMONIC_REASON_MESSAGE: Readonly<Record<MnemonicInvalidReason, string>> = {
  [MNEMONIC_INVALID_REASON.Empty]: 'the phrase is empty',
  [MNEMONIC_INVALID_REASON.WordCount]: 'the number of words is not allowed',
  [MNEMONIC_INVALID_REASON.UnknownWord]: 'one or more words are missing from the BIP-39 word list',
  [MNEMONIC_INVALID_REASON.Checksum]: 'the BIP-39 checksum does not match',
}

/**
 * The mnemonic failed BIP-39 validation.
 *
 * The message contains neither the phrase nor any of its words: error
 * text lands in the log and in a crash report. Positions of bad words
 * are returned separately, through the validation result, and stay in
 * the caller's memory.
 */
export class InvalidMnemonicError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidMnemonic

  /** Machine-readable reason. The UI picks a hint from this. */
  readonly reason: MnemonicInvalidReason

  constructor(reason: MnemonicInvalidReason) {
    super(`The seed phrase is invalid: ${MNEMONIC_REASON_MESSAGE[reason]}.`)
    this.reason = reason
  }
}

export class InvalidPrivateKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPrivateKey

  constructor() {
    super('The private key is invalid.')
  }
}

export class AccountNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountNotFound

  constructor(identifier: string) {
    super(`Account was not found: ${identifier}`)
  }
}

export class AccountAlreadyExistsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountAlreadyExists

  constructor(address: string) {
    super(`The account has already been added: ${address}`)
  }
}

/**
 * The account cannot be removed.
 *
 * Applies to accounts derived from the seed phrase. They cannot be
 * deleted not by developer choice but by BIP-32: the same account
 * will reappear on the next restore from the same phrase.
 *
 * A "delete" button that only hides the record misleads the user
 * about what happens to their funds. Honest behaviour is a refusal
 * with an explanation and an offer to hide the account.
 */
export class AccountNotRemovableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountNotRemovable

  constructor(reason: string) {
    super(`The account cannot be removed: ${reason}`)
  }
}

export class KeyringNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringNotFound

  constructor(keyringId: string) {
    super(`Keyring was not found: ${keyringId}`)
  }
}

/**
 * The keyring cannot sign.
 *
 * A normal situation for watch-only accounts and for a hardware
 * wallet that is not physically connected.
 */
export class KeyringCannotSignError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringCannotSign

  constructor(reason: string) {
    super(`Signing is not possible: ${reason}`)
  }
}

/**
 * Secret export is forbidden.
 *
 * Arises when trying to dump a private key from a hardware wallet
 * (physically impossible) or when the operation was not explicitly
 * confirmed.
 */
export class ExportNotPermittedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ExportNotPermitted

  constructor(reason: string) {
    super(`Exporting the secret is not allowed: ${reason}`)
  }
}
