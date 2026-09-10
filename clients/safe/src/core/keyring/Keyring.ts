import type { ISecretBuffer } from '@/core/encryption'
import type { ISignableTransaction, ITypedData } from '@/core/transaction'
import type { Address, DerivationPath, HexString, KeyringId } from '@/core/types'

import type {
  IKeyringCapabilities,
  ISerializedKeyring,
  KeyringCreationOptions,
  KeyringType,
} from './types'

/**
 * Keyring: the only owner of secrets in the application.
 *
 * This is the central security abstraction. Bounds that every
 * implementation must keep:
 *
 * 1. **A secret does not leave.** Public methods return addresses
 *    and finished signatures. The only exception is
 *    `exportPrivateKey`, which requires a separate password
 *    confirmation one level up and returns a buffer that must be
 *    wiped immediately.
 *
 * 2. **A secret does not enter UI state.** A Zustand store is an
 *    ordinary object on the tab heap: it is visible in React
 *    DevTools, reachable by any script on the page, and serialised
 *    in a debug state dump.
 *
 * 3. **A secret lives in `Uint8Array`, not `string`.** Strings in
 *    JavaScript are immutable and interned — they cannot be wiped.
 *
 * 4. **`wipe()` must zero the buffers**, not merely drop references
 *    to them. Dropping a reference leaves the data on the heap
 *    until garbage collection, whose timing is not controlled.
 *
 * The abstraction covers software keys and hardware devices
 * uniformly. That is why every signing method is async: a Ledger
 * signature needs a physical confirmation and takes seconds.
 */
export interface IKeyring {
  readonly id: KeyringId
  readonly type: KeyringType

  /** What this keyring can do. Checked before the sign form is shown. */
  readonly capabilities: IKeyringCapabilities

  getAddresses(): Promise<readonly Address[]>

  /**
   * Derives the next account from the same root.
   *
   * @throws KeyringCannotSignError if the keyring type does not
   *         support derivation.
   */
  deriveAccount(): Promise<Address>

  /** Derivation path of an address. `null` for keyrings with no HD structure. */
  getDerivationPath(address: Address): DerivationPath | null

  /**
   * Signs a transaction.
   *
   * What goes to signing is an already-prepared and checked
   * structure. The keyring does not change it and does not fill in
   * fields: any edit here would mean a mismatch between what the
   * user was shown and what was signed.
   *
   * @throws KeyringCannotSignError, UserRejectedError
   */
  signTransaction(address: Address, transaction: ISignableTransaction): Promise<HexString>

  /**
   * Signs an arbitrary message (`personal_sign`).
   *
   * The implementation must apply the EIP-191 prefix. Without it
   * the signed bytes may be a valid transaction, and the signature
   * of a "harmless" message becomes a signature of a funds transfer.
   */
  signMessage(address: Address, message: Uint8Array): Promise<HexString>

  /**
   * Signs structured data (EIP-712).
   *
   * More dangerous than signing a transaction: the signed message
   * can be presented to a contract later. The caller must show the
   * parsed structure and check `domain.chainId` against the active
   * network.
   */
  signTypedData(address: Address, typedData: ITypedData): Promise<HexString>

  /**
   * Exports a private key.
   *
   * Requires a password confirmation one level up. The caller must
   * wipe the returned buffer in a `finally` block.
   *
   * @throws ExportNotPermittedError for hardware and watch-only
   *         keyrings.
   */
  exportPrivateKey(address: Address): Promise<ISecretBuffer>

  serialize(): Promise<ISerializedKeyring>

  /** Zeroes every secret buffer. Called when the wallet is locked. */
  wipe(): void
}

/**
 * Keyring factory.
 *
 * Injected as a dependency. This is the extension point: Ledger and
 * Trezor support is added by a factory implementation, without
 * changing `IWallet` or anything that depends on it.
 */
export interface IKeyringFactory {
  create(options: KeyringCreationOptions): Promise<IKeyring>

  deserialize(serialized: ISerializedKeyring): Promise<IKeyring>

  supports(type: KeyringType): boolean
}
