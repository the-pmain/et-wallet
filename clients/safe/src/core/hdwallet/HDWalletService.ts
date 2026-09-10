import { HDKey } from '@scure/bip32'

import { secp256k1 } from '@noble/curves/secp256k1.js'

import { PUBLIC_KEY_FORMAT, publicKeyToAddress, type PublicKeyFormat } from '@/core/address'
import { SecretBuffer, type ISecretBuffer } from '@/core/encryption'
import {
  ExportNotPermittedError,
  InvalidExtendedKeyError,
  InvalidPublicKeyError,
  KeyringCannotSignError,
  NotInitializedError,
} from '@/core/errors'
import { EXPORT_KIND, hdAccountScope, type ExportKind, type ExportPermit } from '@/core/security'
import { SigningService, type ISigningService, type SignableMessage } from '@/core/signing'
import type { ISignableTransaction, ISignedTransaction, ITypedData } from '@/core/transaction'
import type { Address, ChainId, DerivationPath, HexString } from '@/core/types'

import type { IHDWalletOptions, IHDWalletService } from './contracts'
import {
  assertValidIndex,
  buildAccountPath,
  buildChangePath,
  type IDerivationPathOptions,
} from './path'
import { MAX_ACCOUNTS_PER_CALL, type IHdAccount } from './types'

/**
 * Cap on remembered public projections of addresses.
 *
 * A wallet with a hundred accounts still benefits from the cache,
 * and an index walk by outside code stops there.
 */
const MAX_CACHED_ACCOUNTS = 256

const SERVICE_NAME = 'HDWalletService'

const MIN_SEED_LENGTH = 16

const MAX_SEED_LENGTH = 64

/**
 * HD wallet on top of `@scure/bip32`.
 *
 * LAYOUT. The instance holds two tree nodes:
 * - the account node `m/44'/60'/0'` — extended keys are exported from it;
 * - the chain node `m/44'/60'/0'/0` — addresses are derived from it.
 *
 * Both are computed once at creation. Further address derivation is
 * one non-hardened step from the chain node, not five steps from the
 * root. The difference matters: hardened derivation is more expensive,
 * and a list of twenty addresses is built every time the accounts
 * screen opens.
 *
 * The root node is NOT kept after those two are computed: holding
 * the key to the whole tree when only one branch is needed expands
 * the secret perimeter for no gain.
 */
export class HDWalletService implements IHDWalletService {
  readonly accountPath: DerivationPath

  readonly #changePath: DerivationPath

  /* Signing is the only operation that needs the private key.
     Keeping it here lets the key never leave the module. */
  readonly #signing: ISigningService = new SigningService()

  /**
   * Cache of the PUBLIC projection of addresses.
   *
   * WHAT LIVES HERE AND WHAT DOES NOT. Address, public key, and path
   * are what is already shown on screen. There are no `HDKey` nodes
   * here on purpose: a node holds a private key, and caching it would
   * keep in memory exactly what the rest of the code tries not to
   * retain. Signing always derives the key again and wipes it —
   * that path must not be sped up.
   *
   * Cleared in `wipe()` together with the keys: addresses are not a
   * secret, but an address map that outlives the lock tells an
   * observer what was used.
   */
  readonly #publicCache = new Map<number, IHdAccount>()

  #accountNode: HDKey | null
  #changeNode: HDKey | null

  private constructor(
    accountNode: HDKey,
    changeNode: HDKey,
    accountPath: DerivationPath,
    changePath: DerivationPath,
  ) {
    this.#accountNode = accountNode
    this.#changeNode = changeNode
    this.accountPath = accountPath
    this.#changePath = changePath
  }

  /**
   * Creates a wallet from a BIP-39 binary seed.
   *
   * @param seed 16..64 bytes. Ownership is NOT transferred: the
   *        buffer stays with the caller, and they must wipe it.
   * @throws InvalidArgumentError on an illegal seed length.
   */
  static fromSeed(seed: ISecretBuffer, options: IHDWalletOptions = {}): HDWalletService {
    const bytes = seed.bytes

    if (bytes.length < MIN_SEED_LENGTH || bytes.length > MAX_SEED_LENGTH) {
      throw new InvalidExtendedKeyError(
        `the seed length must be between ${String(MIN_SEED_LENGTH)} and ${String(MAX_SEED_LENGTH)} bytes`,
      )
    }

    const accountPath = buildAccountPath(options)
    const changePath = buildChangePath(options)

    const root = HDKey.fromMasterSeed(bytes)

    try {
      const accountNode = root.derive(accountPath)
      const changeNode = accountNode.derive(HDWalletService.#relativeChangePath(options))

      return new HDWalletService(accountNode, changeNode, accountPath, changePath)
    } finally {
      /* The root key is no longer needed: both required nodes are
         obtained. Keeping it in memory would store access to the
         whole tree for access to one branch. */
      root.wipePrivateData()
    }
  }

  /**
   * Creates a wallet from an ACCOUNT-level extended key.
   *
   * Both xprv and xpub are accepted. In the latter case the instance
   * is watch-only: addresses are derived, private keys are unavailable.
   * That mode matches the `WatchOnly` keyring type.
   *
   * @throws InvalidExtendedKeyError if the string cannot be parsed
   *         or does not match the account level.
   */
  static fromAccountExtendedKey(
    extendedKey: string,
    options: IHDWalletOptions = {},
  ): HDWalletService {
    let accountNode: HDKey

    try {
      accountNode = HDKey.fromExtendedKey(extendedKey)
    } catch (error) {
      /* The library exception text is not rethrown: a fragment of
         the parsed key may be in it, and an xprv is a secret. */
      throw new InvalidExtendedKeyError('the string cannot be parsed as a BIP-32 key', {
        cause: error,
      })
    }

    const changeNode = accountNode.derive(HDWalletService.#relativeChangePath(options))

    return new HDWalletService(
      accountNode,
      changeNode,
      buildAccountPath(options),
      buildChangePath(options),
    )
  }

  get canDerivePrivateKeys(): boolean {
    return this.#accountNode?.privateKey != null
  }

  get isWiped(): boolean {
    return this.#accountNode === null
  }

  deriveAccount(addressIndex: number): IHdAccount {
    const cached = this.#publicCache.get(addressIndex)

    if (cached !== undefined) {
      return cached
    }

    const node = this.#deriveAddressNode(addressIndex)
    const publicKey = HDWalletService.#requirePublicKey(node)

    const account: IHdAccount = {
      addressIndex,
      path: `${this.#changePath}/${String(addressIndex)}` as DerivationPath,
      address: publicKeyToAddress(publicKey),
      publicKey,
    }

    /* A cap just in case: an index walk by outside code would
       otherwise grow the map without bound. Entries past the cap
       are simply not remembered — derivation is not broken by that. */
    if (this.#publicCache.size < MAX_CACHED_ACCOUNTS) {
      this.#publicCache.set(addressIndex, account)
    }

    return account
  }

  deriveAccounts(startIndex: number, count: number): readonly IHdAccount[] {
    assertValidIndex(startIndex, 'startIndex')

    if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_ACCOUNTS_PER_CALL) {
      throw new InvalidExtendedKeyError(
        `count must be an integer between 1 and ${String(MAX_ACCOUNTS_PER_CALL)}`,
      )
    }

    const accounts: IHdAccount[] = []

    for (let offset = 0; offset < count; offset += 1) {
      accounts.push(this.deriveAccount(startIndex + offset))
    }

    return accounts
  }

  getAddress(addressIndex: number): Address {
    return this.deriveAccount(addressIndex).address
  }

  getPublicKey(
    addressIndex: number,
    format: PublicKeyFormat = PUBLIC_KEY_FORMAT.Compressed,
  ): Uint8Array {
    const compressed = HDWalletService.#requirePublicKey(this.#deriveAddressNode(addressIndex))

    if (format === PUBLIC_KEY_FORMAT.Compressed) {
      return compressed
    }

    return secp256k1.Point.fromBytes(compressed).toBytes(false)
  }

  signTransaction(addressIndex: number, transaction: ISignableTransaction): ISignedTransaction {
    return this.#withPrivateKey(addressIndex, (key) =>
      this.#signing.signTransaction(transaction, key),
    )
  }

  signMessage(addressIndex: number, message: SignableMessage): HexString {
    return this.#withPrivateKey(addressIndex, (key) => this.#signing.signMessage(message, key))
  }

  signTypedData(addressIndex: number, data: ITypedData, expectedChainId: ChainId): HexString {
    return this.#withPrivateKey(addressIndex, (key) =>
      this.#signing.signTypedData(data, key, expectedChainId),
    )
  }

  exportPrivateKey(addressIndex: number, permit: ExportPermit): ISecretBuffer {
    this.#consumePermit(permit, EXPORT_KIND.PrivateKey, addressIndex)

    return this.#extractPrivateKey(addressIndex)
  }

  deriveByPath(path: DerivationPath): IHdAccount {
    const accountNode = this.#requireActiveAccountNode()

    /* The path is given from the root, and the root key is
       deliberately not kept. Derivation is therefore relative to
       the account node: HDKey treats a path starting with `m` as
       requiring the root node. */
    const relative = HDWalletService.#toRelativePath(path, this.accountPath)
    const node = relative === '' ? accountNode : accountNode.derive(`m/${relative}`)
    const publicKey = HDWalletService.#requirePublicKey(node)

    return {
      addressIndex: node.index,
      path,
      address: publicKeyToAddress(publicKey),
      publicKey,
    }
  }

  exportAccountXpub(permit: ExportPermit): string {
    this.#consumePermit(permit, EXPORT_KIND.Xpub, null)

    return this.#requireActiveAccountNode().publicExtendedKey
  }

  exportChangeXpub(permit: ExportPermit): string {
    this.#consumePermit(permit, EXPORT_KIND.Xpub, null)

    return this.#requireActiveChangeNode().publicExtendedKey
  }

  exportAccountXprv(permit: ExportPermit): ISecretBuffer {
    this.#consumePermit(permit, EXPORT_KIND.Xprv, null)

    const node = this.#requireActiveAccountNode()

    if (node.privateKey === null) {
      throw new KeyringCannotSignError(
        'the wallet was created from an extended public key: there is no private key',
      )
    }

    /* An extended key is a base58 string: it cannot be wiped, like
       any string in JavaScript. Moving it into a buffer limits the
       leak to one value, but does not remove it. */
    return SecretBuffer.fromUtf8(node.privateExtendedKey)
  }

  /**
   * Internal access to the account node's public key.
   *
   * Needed to build an xpub for risk evaluation WITHOUT actually
   * issuing the secret. The value does not leave the core.
   *
   * @internal
   */
  peekAccountXpub(): string {
    return this.#requireActiveAccountNode().publicExtendedKey
  }

  wipe(): void {
    this.#accountNode?.wipePrivateData()
    this.#changeNode?.wipePrivateData()
    this.#accountNode = null
    this.#changeNode = null
    this.#publicCache.clear()
  }

  #deriveAddressNode(addressIndex: number): HDKey {
    assertValidIndex(addressIndex, 'addressIndex')

    return this.#requireActiveChangeNode().deriveChild(addressIndex)
  }

  /**
   * Runs an operation with the private key and wipes it for sure.
   *
   * The key exists only for the handler call and never leaves the
   * module. The wipe in `finally` runs even if signing throws.
   *
   * Before this method there was a public `getPrivateKeyForSigning`
   * that handed the key out. It was removed: signing is the only
   * reason the key is needed, and it should be done where the key
   * already is.
   */
  #withPrivateKey<TResult>(
    addressIndex: number,
    operation: (privateKey: ISecretBuffer) => TResult,
  ): TResult {
    const privateKey = this.#extractPrivateKey(addressIndex)

    try {
      return operation(privateKey)
    } finally {
      privateKey.wipe()
    }
  }

  #extractPrivateKey(addressIndex: number): ISecretBuffer {
    const privateKey = this.#deriveAddressNode(addressIndex).privateKey

    if (privateKey === null) {
      throw new KeyringCannotSignError(
        'the wallet was created from an extended public key and works in watch-only mode',
      )
    }

    /* A copy, not a transfer of ownership: `privateKey` is the
       HDKey node's internal buffer. Wiping the returned buffer
       in caller code must not destroy the tree state. */
    return SecretBuffer.copyOf(privateKey)
  }

  /**
   * Checks the permit and marks it used.
   *
   * Order matters: the permit is consumed BEFORE the secret is
   * issued. An exception on issue must not leave a live permit —
   * otherwise a retry would bypass the user's confirmation.
   */
  #consumePermit(permit: ExportPermit, kind: ExportKind, addressIndex: number | null): void {
    if (!permit.matches(kind, hdAccountScope(this.accountPath), addressIndex)) {
      throw new ExportNotPermittedError(
        permit.isConsumed
          ? 'the permit has already been used'
          : 'the permit was issued for a different operation',
      )
    }

    permit.consume()
  }

  #requireActiveAccountNode(): HDKey {
    if (this.#accountNode === null) {
      throw new NotInitializedError(SERVICE_NAME)
    }

    return this.#accountNode
  }

  #requireActiveChangeNode(): HDKey {
    if (this.#changeNode === null) {
      throw new NotInitializedError(SERVICE_NAME)
    }

    return this.#changeNode
  }

  /** Relative path from the account node to the chain node, e.g. `0`. */
  static #relativeChangePath(options: IDerivationPathOptions): string {
    const change = options.change ?? 0

    return `m/${String(change)}`
  }

  static #requirePublicKey(node: HDKey): Uint8Array {
    const publicKey = node.publicKey

    if (publicKey === null) {
      throw new InvalidPublicKeyError('the tree node carries no public key')
    }

    return publicKey
  }

  /** Strips the account-level prefix from a full path. */
  static #toRelativePath(path: DerivationPath, accountPath: DerivationPath): string {
    if (path === accountPath) {
      return ''
    }

    if (!path.startsWith(`${accountPath}/`)) {
      throw new InvalidExtendedKeyError(
        `the path "${path}" lies outside the account branch "${accountPath}"`,
      )
    }

    return path.slice(accountPath.length + 1)
  }
}
