import type { ISecretBuffer } from '@/core/encryption'
import type { IEventSource } from '@/core/events'
import type { IKeyring, KeyringCreationOptions } from '@/core/keyring'
import type { Address, KeyringId } from '@/core/types'

import type {
  ICreateWalletParams,
  IImportWalletParams,
  IVault,
  IWalletCreationResult,
  LockReason,
  WalletEventMap,
  WalletStatus,
} from './types'

/**
 * The wallet as a whole: the encrypted vault and access control to it.
 *
 * Relation to neighbouring abstractions:
 * - `IWallet` owns the vault and the lock state;
 * - `IKeyring` owns the secrets of one key source;
 * - `IAccountService` works with the public projection — addresses
 *   and names.
 *
 * The split lets the UI keep the account list at all times, while
 * access to keys exists only while the lock is lifted.
 */
export interface IWallet extends IEventSource<WalletEventMap> {
  /** Reads the vault and determines the starting state. */
  init(): Promise<void>

  getStatus(): WalletStatus

  isUnlocked(): boolean

  /**
   * Creates a new wallet.
   *
   * Returns the mnemonic exactly once. Getting it again is only
   * possible through `exportMnemonic` with a password. The caller
   * must wipe the buffer after the user confirms.
   *
   * @throws WalletAlreadyInitializedError, WeakPasswordError
   */
  create(params: ICreateWalletParams): Promise<IWalletCreationResult>

  /**
   * Imports a wallet from a mnemonic phrase.
   *
   * @throws WalletAlreadyInitializedError, InvalidMnemonicError, WeakPasswordError
   */
  importFromMnemonic(params: IImportWalletParams): Promise<void>

  /**
   * Unlocks.
   *
   * The implementation must have brute-force protection: a delay
   * between attempts or a cap on their number. KDF hardness slows
   * guessing, but does not remove the need for an application-level
   * limit.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  unlock(password: string): Promise<void>

  /**
   * Locks and zeroes every secret buffer.
   *
   * Synchronous on purpose: the lock must finish before control
   * returns to the event loop. An async lock leaves a window in
   * which the keys are still in memory while the app considers
   * itself locked.
   */
  lock(reason: LockReason): void

  /**
   * Changes the password.
   *
   * Re-encrypts the vault with the new key. The operation must be
   * atomic: a failure mid-rewrite must not leave the vault partly
   * in the old state and partly in the new.
   *
   * @throws InvalidPasswordError, WeakPasswordError
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>

  /**
   * Exports the mnemonic phrase.
   *
   * The password is asked again even if the wallet is already
   * unlocked: showing a seed phrase is irreversible in its
   * consequences, and it must require an explicit proof of
   * password ownership.
   *
   * @throws InvalidPasswordError
   */
  exportMnemonic(password: string): Promise<ISecretBuffer>

  /** Keyrings. Empty list while the wallet is locked. */
  getKeyrings(): readonly IKeyring[]

  getKeyringById(id: KeyringId): IKeyring | null

  /**
   * Finds the keyring that serves an address.
   *
   * Used before signing: pick the keyring by address, not the
   * other way around.
   *
   * @throws AccountNotFoundError
   */
  getKeyringForAddress(address: Address): IKeyring

  /**
   * Adds a keyring: import a private key, connect a hardware
   * wallet, or add a watch-only address.
   *
   * @throws WalletLockedError, AccountAlreadyExistsError
   */
  addKeyring(options: KeyringCreationOptions): Promise<IKeyring>

  /**
   * Removes a keyring.
   *
   * The primary HD keyring cannot be removed: removing it would
   * mean losing access to every account derived from it while
   * they remain on the list.
   */
  removeKeyring(id: KeyringId): Promise<void>

  /**
   * Deletes the wallet entirely.
   *
   * IRREVERSIBLE. Without a saved seed phrase the funds are lost
   * for good. The implementation must require the password, and
   * the caller — an explicit user confirmation.
   */
  reset(password: string): Promise<void>
}

/** Long-term storage of the encrypted key vault. */
export interface IVaultRepository {
  /** Whether the vault exists. Checked before a read is attempted. */
  exists(): Promise<boolean>

  load(): Promise<IVault | null>

  /**
   * Saves the vault.
   *
   * The implementation must write atomically. An interrupted write
   * that leaves a damaged vault means irreversible loss of the keys.
   */
  save(vault: IVault): Promise<void>

  delete(): Promise<void>
}
