import type { IMnemonicCheck, ISecretBuffer, IUnlockThrottleState, MnemonicStrength } from '@/core'

import type { IRemoteUser } from './RemoteUserDirectory'

export const ONBOARDING_STATE = {
  Loading: 'loading',
  Uninitialized: 'uninitialized',
  Locked: 'locked',
  Unlocked: 'unlocked',
} as const

export type OnboardingState = (typeof ONBOARDING_STATE)[keyof typeof ONBOARDING_STATE]

/**
 * Onboarding operations available to pages.
 *
 * The interface is separated from the implementation so pages do not
 * know how storage is provided: in-memory today, IndexedDB later,
 * `chrome.storage` in the extension. A swap must not touch any screen.
 *
 * WHAT THIS INTERFACE OMITS: methods that return secrets except
 * `generateMnemonic`. Passwords go in and do not come back; private
 * keys never appear here.
 */
export interface IOnboardingService {
  getState(): OnboardingState

  subscribe(listener: () => void): () => void

  initialize(): Promise<void>

  /**
   * Creates a new mnemonic phrase.
   *
   * Ownership passes to the caller: the buffer must be wiped after
   * the user confirms they wrote the phrase down.
   */
  generateMnemonic(strength: MnemonicStrength): ISecretBuffer

  toWords(mnemonic: ISecretBuffer): readonly string[]

  /**
   * Checks an entered phrase without throwing.
   *
   * REPLACED `validateMnemonic`. The returned structure extends the
   * old one rather than replacing it: every previous field remains,
   * plus a warning about trivial entropy. Keeping both methods would
   * mean two phrase checks, one weaker — and eventually calling the
   * wrong one.
   */
  checkMnemonic(phrase: string): IMnemonicCheck

  /** Dictionary words by prefix — used as confirmation distractors. */
  findWordsByPrefix(prefix: string, limit?: number): readonly string[]

  /**
   * Creates a wallet from the phrase shown to the user.
   *
   * If the device already had a vault, it is replaced: the create
   * screen does not require a separate reset.
   *
   * @param username Email address. Written to `email` in the `users`
   *        table. Optional at the service level: without it the wallet
   *        stays on-device only. If given, it is email, not a name.
   * @throws WeakPasswordError, InvalidArgumentError if the address is
   *         given and malformed.
   */
  createWallet(
    mnemonic: ISecretBuffer,
    password: string,
    username?: string,
  ): Promise<IRemoteUser | null>

  /**
   * Imports an existing wallet.
   *
   * The previous on-device vault is replaced, as on create.
   *
   * @throws InvalidMnemonicError, WeakPasswordError, InvalidArgumentError
   */
  importWallet(phrase: string, password: string, username?: string): Promise<IRemoteUser | null>

  /**
   * Unlocks the wallet.
   *
   * Takes only a password: the username lives in the same encrypted
   * store and can be compared only after a successful decrypt — i.e.
   * after the password already matched.
   */
  unlock(password: string): Promise<void>

  /**
   * Returns the stored email address.
   *
   * Available only after unlock: the address is stored encrypted.
   * `null` means the wallet was created without one.
   */
  getUsername(): Promise<string | null>

  /**
   * Row id in the `users` table, if the wallet has already registered
   * on the server.
   *
   * Available only after unlock: the value lives in encrypted storage.
   * `null` — no directory, or the row has not been created yet.
   */
  getRemoteUserId(): Promise<string | null>

  /**
   * Checks the password without changing lock state.
   *
   * Used for re-confirmation before a risky action: that happens in an
   * already unlocked wallet, so there is nothing to unlock again.
   * The check uses the same path as unlock — decrypting a control value.
   */
  verifyPassword(password: string): Promise<boolean>

  /**
   * The attempt limiter is off: sign-in does not count failures
   * and does not lock the form. The method remains so the sign-in
   * screen does not depend on whether a counter is wired up.
   */
  getUnlockThrottleState(): Promise<IUnlockThrottleState>

  lock(): void

  /**
   * Erases the wallet entirely.
   *
   * IRREVERSIBLE. Without a written seed phrase, funds are lost.
   * A password is not required on purpose: this path exists for
   * the case when the password is forgotten.
   */
  reset(): Promise<void>

  /**
   * Accepts a wallet erase performed in another tab.
   *
   * Storage was already destroyed by that tab; this drops access
   * here — otherwise the tab would keep showing balances and
   * offering send while holding keys in memory.
   */
  handleExternalReset(): void
}
