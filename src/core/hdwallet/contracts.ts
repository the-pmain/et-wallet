import type { PublicKeyFormat } from '@/core/address'
import type { ISecretBuffer } from '@/core/encryption'
import type { ExportPermit } from '@/core/security'
import type { SignableMessage } from '@/core/signing'
import type { ISignableTransaction, ISignedTransaction, ITypedData } from '@/core/transaction'
import type { Address, ChainId, DerivationPath, HexString } from '@/core/types'

import type { IDerivationPathOptions } from './path'
import type { IHdAccount } from './types'

/**
 * Hierarchical deterministic wallet per BIP-32 and BIP-44.
 *
 * SECRET OWNERSHIP. The instance holds in memory the root key derived
 * from the seed. This is not a singleton: each keyring (`IKeyring`)
 * gets its own instance, and each must be wiped with `wipe()` when
 * the wallet is locked.
 *
 * DEFAULT PATH: `m/44'/60'/0'/0/n`, where the address index is
 * incremented. Matches MetaMask, Rabby, and Trust Wallet. Ledger Live
 * uses another convention — see the comment on `accountIndex` in
 * `IDerivationPathOptions`.
 */
export interface IHDWalletService {
  /** Whether the instance can issue private keys and sign. */
  readonly canDerivePrivateKeys: boolean

  /** Whether the root key has been wiped. After `wipe()` no operations are available. */
  readonly isWiped: boolean

  /** Account-level path from which addresses are derived. */
  readonly accountPath: DerivationPath

  /**
   * Derives an account by address index.
   *
   * The result has no private key — that is issued by a separate method.
   */
  deriveAccount(addressIndex: number): IHdAccount

  /**
   * Derives consecutive accounts.
   *
   * @param startIndex Index of the first account.
   * @param count Count, at most `MAX_ACCOUNTS_PER_CALL`.
   */
  deriveAccounts(startIndex: number, count: number): readonly IHdAccount[]

  getAddress(addressIndex: number): Address

  /**
   * Public key by index.
   *
   * Not a secret: a private key cannot be recovered from a public
   * key. Still it should not be disclosed without need — it ties
   * the address to a branch of the tree.
   */
  getPublicKey(addressIndex: number, format?: PublicKeyFormat): Uint8Array

  /**
   * Signs a transaction with the key of the given address.
   *
   * The private key is derived, used, and wiped inside the call.
   * It never leaves: there used to be a method that handed the key
   * out for the caller to sign, and that was an unnecessary expansion
   * of the secret perimeter — signing is the only reason the key is needed.
   *
   * Checks performed before signing are described on `ISigningService`.
   *
   * @throws KeyringCannotSignError for an instance created from an xpub.
   * @throws InvalidArgumentError if `from` does not match the address
   *         at the given index, or chainId is missing.
   */
  signTransaction(addressIndex: number, transaction: ISignableTransaction): ISignedTransaction

  /**
   * Signs an arbitrary message per EIP-191 (`personal_sign`).
   *
   * The prefix is always applied: without it the signed bytes may
   * be a valid transaction.
   *
   * @throws KeyringCannotSignError
   */
  signMessage(addressIndex: number, message: SignableMessage): HexString

  /**
   * Signs structured data (`eth_signTypedData_v4`).
   *
   * `domain.chainId` is checked against the passed active network.
   *
   * @throws KeyringCannotSignError, InvalidArgumentError
   */
  signTypedData(addressIndex: number, data: ITypedData, expectedChainId: ChainId): HexString

  /**
   * Issues the address private key TO THE USER.
   *
   * HIGHEST DANGER LEVEL. Owning the value is owning the funds
   * on the address.
   *
   * A SEPARATE WARNING. The private key of ANY child address
   * together with a previously issued xpub lets the parent private
   * key be computed, and therefore every address of the account.
   * `ExportGuard` evaluates that condition; a permit for such an
   * operation can only be obtained after confirming the
   * `AccountCompromise` risk level.
   *
   * @param permit One-shot permit issued by `ExportGuard`.
   * @throws ExportNotPermittedError if the permit does not match
   *         the operation or has already been used.
   * @throws KeyringCannotSignError for an instance created from an xpub.
   */
  exportPrivateKey(addressIndex: number, permit: ExportPermit): ISecretBuffer

  /**
   * Derives an account by an arbitrary path.
   *
   * Needed when importing an address derived by another wallet on
   * a non-standard branch. The path is given in full and need not
   * follow BIP-44.
   */
  deriveByPath(path: DerivationPath): IHdAccount

  /**
   * Extended PUBLIC key at the account level (`m/44'/60'/0'`).
   *
   * Lets a third-party app compute every address of the account
   * without access to the funds. Used for watch-only and accounting.
   *
   * PRIVACY RISK: the xpub recipient sees the whole operation
   * history of every address of the account, tied together. That
   * reveals portfolio size and counterparties.
   */
  exportAccountXpub(permit: ExportPermit): string

  /**
   * Extended public key at the chain level (`m/44'/60'/0'/0`).
   *
   * A CRITICAL WARNING that applies to any xpub of a non-hardened
   * level.
   *
   * The `change` and `addressIndex` levels are not hardened by
   * BIP-44 — otherwise the xpub would be useless. The other side:
   * from a parent's extended PUBLIC key and the private key of ANY
   * of its children, the parent's PRIVATE key is recovered
   * arithmetically, and from it — the private keys of every other
   * child.
   *
   * Practical conclusion: issuing an xpub for watch-only is safe
   * by itself, but becomes a full account compromise if the same
   * recipient ever gets the private key of even one address.
   * The UI must warn about this on export.
   */
  exportChangeXpub(permit: ExportPermit): string

  /**
   * Extended PRIVATE key at the account level.
   *
   * THE MOST DANGEROUS OPERATION IN THE MODULE. This is not the
   * key of one address, it is the key of the whole branch: the
   * owner gains control of every address of the account, including
   * those not yet created. In consequences it is comparable to
   * issuing the seed phrase.
   *
   * Requires a password confirmation one layer up. The returned
   * buffer must be wiped immediately.
   *
   * @throws KeyringCannotSignError for an instance created from an xpub.
   */
  exportAccountXprv(permit: ExportPermit): ISecretBuffer

  /**
   * Account-level extended public key WITHOUT issuing it outward.
   *
   * Needed by internal core consumers — e.g. to restore a watch
   * node on restart. Needs no permit precisely because the value
   * does not leave the core.
   *
   * @internal
   */
  peekAccountXpub(): string

  /**
   * Wipes the root and derived keys.
   *
   * Called when the wallet is locked. The method is synchronous:
   * the lock must finish before control returns to the event loop.
   */
  wipe(): void
}

/**
 * Instance creation parameters.
 *
 * An alias, not an interface that extends: an empty child interface
 * adds nothing to the supertype and only creates the appearance of
 * a separate entity. A separate name is needed as an extension
 * point if parameters unrelated to the derivation path appear.
 */
export type IHDWalletOptions = IDerivationPathOptions
