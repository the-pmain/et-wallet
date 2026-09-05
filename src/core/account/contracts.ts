import type { ISecretBuffer } from '@/core/encryption'
import type { IEventSource } from '@/core/events'
import type { ExportPermit } from '@/core/security'
import type { AccountId, Address } from '@/core/types'

import type {
  AccountEventMap,
  IAccount,
  ICreateAccountParams,
  IImportPrivateKeyParams,
} from './types'

/**
 * Wallet account management.
 *
 * The service works with the PUBLIC projection of keys: addresses,
 * names, display order. None of its methods returns a secret —
 * except `exportPrivateKey`, which requires both a password and a
 * permit from `ExportGuard`.
 *
 * TWO ACCOUNT SOURCES, and the difference between them defines
 * behaviour:
 *
 * | Source       | Key recoverable from seed | Removal |
 * | ------------ | ------------------------- | ------- |
 * | HD tree      | yes                       | impossible, hide only |
 * | Imported     | no                        | possible, irreversible |
 *
 * Account metadata is stored encrypted. Addresses themselves are
 * not a secret, but their list ties every account of one user, so
 * a locked wallet does not reveal them.
 */
export interface IAccountManager extends IEventSource<AccountEventMap> {
  /**
   * Loads accounts from storage.
   *
   * @throws WalletLockedError if storage is locked.
   */
  init(): Promise<void>

  /** Every account, including hidden ones, in user order. */
  list(): readonly IAccount[]

  /** Visible accounts only. This is the list shown in the UI. */
  listVisible(): readonly IAccount[]

  /** Active account. `null` if there are no accounts yet. */
  getActive(): IAccount | null

  getById(id: AccountId): IAccount | null

  getByAddress(address: Address): IAccount | null

  /**
   * Changes the active account.
   *
   * A hidden account does not become active: it is not shown in the
   * UI, and the user would not understand where the funds leave from.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  setActive(id: AccountId): Promise<void>

  /**
   * Derives the next account from the HD tree.
   *
   * The address index is chosen as the one after the maximum already
   * created, not as the account count: an HD account cannot be
   * deleted, but it can be hidden, and counting by quantity would
   * reuse an index.
   *
   * @throws WalletLockedError
   */
  create(params?: ICreateAccountParams): Promise<IAccount>

  /**
   * Imports an account from a private key.
   *
   * The key is stored encrypted and from that moment exists in a
   * single copy: it is not recovered from the seed phrase.
   *
   * @throws AccountAlreadyExistsError if the address is already added.
   * @throws InvalidPrivateKeyError for an unfit key.
   * @throws WalletLockedError
   */
  importPrivateKey(params: IImportPrivateKeyParams): Promise<IAccount>

  /**
   * Renames an account.
   *
   * The name is normalised: control characters are stripped, spaces
   * are collapsed, length is checked.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  rename(id: AccountId, name: string): Promise<void>

  /**
   * Hides or shows an account.
   *
   * Hiding is the only available way to remove an HD account from
   * the list. The active account cannot be hidden: the UI would be
   * left without a chosen sender.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  setHidden(id: AccountId, hidden: boolean): Promise<void>

  /**
   * Removes an imported account together with its key.
   *
   * IRREVERSIBLE. An imported key is not recovered from the seed
   * phrase: after removal, access to funds on that address is lost
   * unless the key is saved separately.
   *
   * The password is required for exactly that reason.
   *
   * @throws AccountNotRemovableError for HD-tree accounts.
   * @throws InvalidPasswordError, AccountNotFoundError
   */
  remove(id: AccountId, password: string): Promise<void>

  /**
   * Changes display order.
   *
   * The list must contain the identifiers of every existing account:
   * a partial order would leave some accounts without a position.
   *
   * @throws InvalidArgumentError
   */
  reorder(orderedIds: readonly AccountId[]): Promise<void>

  /**
   * Exports an account private key.
   *
   * REQUIRES TWO INDEPENDENT CONFIRMATIONS, each closing its own
   * risk:
   *
   * - **password** — proves the owner is at the device now, not
   *   someone left with an unlocked wallet;
   * - **`ExportGuard` permit** — proves the user was shown the risk
   *   level, including the case where revealing the key together
   *   with a previously issued xpub discloses the whole account.
   *
   * The caller must wipe the returned buffer in a `finally` block.
   *
   * @throws InvalidPasswordError, ExportNotPermittedError, AccountNotFoundError
   */
  exportPrivateKey(id: AccountId, password: string, permit: ExportPermit): Promise<ISecretBuffer>
}

/**
 * Long-term storage of account metadata.
 *
 * Contains no secrets: private keys of imported accounts are stored
 * separately and never enter this structure.
 */
export interface IAccountRepository {
  findAll(): Promise<readonly IAccount[]>
  save(account: IAccount): Promise<void>
  saveAll(accounts: readonly IAccount[]): Promise<void>
  delete(id: AccountId): Promise<void>

  getActiveId(): Promise<AccountId | null>
  setActiveId(id: AccountId): Promise<void>
}
