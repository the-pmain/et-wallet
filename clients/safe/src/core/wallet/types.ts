import type { IEncryptedPayload, ISecretBuffer } from '@/core/encryption'
import type { ISerializedKeyring } from '@/core/keyring'
import type { Timestamp } from '@/core/types'

/**
 * Wallet state.
 *
 * Three states, not a "locked" flag: "not created" and "locked" are
 * fundamentally different situations. In the first the UI must offer
 * create or import, in the second — a password. Collapsing them to
 * one boolean leads to a password screen for a wallet that does not
 * exist.
 */
export const WALLET_STATUS = {
  /** The vault has not been created. Create or import is required. */
  Uninitialized: 'uninitialized',
  /** The vault exists, keys are encrypted. A password is required. */
  Locked: 'locked',
  /** Keys are decrypted and in memory. */
  Unlocked: 'unlocked',
} as const

export type WalletStatus = (typeof WALLET_STATUS)[keyof typeof WALLET_STATUS]

/**
 * Reason for the lock.
 *
 * Distinguished for the UI: a timeout lock should be accompanied by
 * an explanation, a user-requested lock should not.
 */
export const LOCK_REASON = {
  User: 'user',
  Timeout: 'timeout',
  /** The app is closing or the tab is unloading. */
  Shutdown: 'shutdown',
} as const

export type LockReason = (typeof LOCK_REASON)[keyof typeof LOCK_REASON]

/**
 * Decrypted vault contents.
 *
 * Exists only in memory while unlocked. Never saved and never
 * serialised in the clear.
 */
export interface IVaultContent {
  readonly keyrings: readonly ISerializedKeyring[]
}

/**
 * Encrypted vault as it sits in persistent storage.
 *
 * Metadata (`createdAt`, `updatedAt`) is outside the encryption on
 * purpose: it is not a secret, and being available without a
 * password lets the user see backup details before unlock.
 */
export interface IVault {
  readonly payload: IEncryptedPayload
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

/**
 * Result of creating a new wallet.
 *
 * The mnemonic is returned as a buffer, not a string, and must be
 * wiped as soon as the user confirms they have saved it. Holding a
 * seed phrase in React state for the rest of the session is
 * forbidden.
 */
export interface IWalletCreationResult {
  readonly mnemonic: ISecretBuffer
}

export interface ICreateWalletParams {
  readonly password: string

  /**
   * Mnemonic strength in bits: 128 (12 words) or 256 (24 words).
   *
   * Entropy comes exclusively from `crypto.getRandomValues`.
   * `Math.random` is unsuitable: it is not cryptographically
   * strong, and keys derived from it are predictable.
   */
  readonly strength?: 128 | 256
}

export interface IImportWalletParams {
  readonly mnemonic: ISecretBuffer
  readonly password: string
  readonly accountCount?: number
}

export interface WalletEventMap {
  'wallet:initialized': { readonly at: Timestamp }
  'wallet:unlocked': { readonly at: Timestamp }
  'wallet:locked': { readonly at: Timestamp; readonly reason: LockReason }
  'wallet:reset': { readonly at: Timestamp }
  /** Keyring set changed: an account source was added or removed. */
  'wallet:keyringsChanged': { readonly count: number }
}
