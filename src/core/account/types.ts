import type { ISecretBuffer } from '@/core/encryption'
import type { KEYRING_TYPE, KeyringType } from '@/core/keyring'
import type { AccountId, Address, DerivationPath, KeyringId, Timestamp } from '@/core/types'

/**
 * A wallet account — the PUBLIC projection of a key.
 *
 * This structure has no private key and cannot have one. It enters
 * UI state, is serialised, and is stored. Secrets live separately.
 *
 * The identifier is separated from the address on purpose: the same
 * address may be added again from another source (first as watched,
 * then via a hardware wallet), and binding the entity to the address
 * would lose the user-given name and settings on re-import.
 */
export interface IAccount {
  readonly id: AccountId

  /** Address in EIP-55 checksum. */
  readonly address: Address

  /** Name given by the user or assigned by default. */
  readonly name: string

  /** Key-source type. Determines whether the account can be removed. */
  readonly source: KeyringType

  /** Key set the account belongs to. */
  readonly keyringId: KeyringId

  /**
   * Derivation path. `null` for imported accounts: they belong to
   * no tree.
   */
  readonly derivationPath: DerivationPath | null

  /**
   * Address index in the HD tree. `null` for imported accounts.
   *
   * Stored separately from the path because it is used directly at
   * signing: `HDWalletService` takes an index, not a path.
   */
  readonly addressIndex: number | null

  /**
   * Position in the list. Set by the user by dragging. Not tied to
   * the derivation index: display order and position in the HD tree
   * are different things.
   */
  readonly order: number

  /**
   * Whether the account is hidden in the UI.
   *
   * For HD accounts hiding is the only alternative to deletion: an
   * account derived from the seed phrase will reappear on the next
   * wallet restore. The flag honestly reflects that limit.
   */
  readonly hidden: boolean

  readonly createdAt: Timestamp
}

export interface ICreateAccountParams {
  /** Name. If omitted, assigned from the ordinal number. */
  readonly name?: string

  /**
   * Address number in the BIP-44 tree.
   *
   * USUALLY OMITTED: the wallet takes the next free one. An explicit
   * number is needed for restore — there accounts are created from
   * found addresses, and there may be gaps between them. Creating
   * them in a row would yield different addresses and miss the funds
   * on them.
   */
  readonly addressIndex?: number
}

export interface IImportPrivateKeyParams {
  /**
   * Private key, 32 bytes.
   *
   * Ownership is NOT transferred: the buffer stays with the caller,
   * and wiping it is their job. The service makes its own copy for
   * encryption.
   */
  readonly privateKey: ISecretBuffer

  readonly name?: string
}

export interface AccountEventMap {
  /**
   * The set of accounts has changed.
   *
   * Matches the `accountsChanged` event of EIP-1193. Conversion to
   * the external format is done by the dApp connection layer: the
   * core need not know that dApps exist.
   */
  'account:listChanged': { readonly accounts: readonly Address[] }

  'account:activeChanged': { readonly address: Address }
}

/**
 * Parameters for adding a hardware-wallet account.
 *
 * There is no secret among them: address and path are public, and
 * the key stays in the device.
 */
export interface IAddHardwareAccountParams {
  readonly type: typeof KEYRING_TYPE.Ledger | typeof KEYRING_TYPE.Trezor

  /** Address read from the device and confirmed by the user. */
  readonly address: Address

  /** Path the device derived it at. */
  readonly path: DerivationPath

  readonly name?: string
}
