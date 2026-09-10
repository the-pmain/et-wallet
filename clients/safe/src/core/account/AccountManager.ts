import { keccak256, toUtf8Bytes } from 'ethers'

import { areAddressesEqual, privateKeyToAddress } from '@/core/address'
import { withSecretSync, type ISecretBuffer, type ISecureStorage } from '@/core/encryption'
import { EventBus, type EventListener } from '@/core/events'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
  AccountNotRemovableError,
  ExportNotPermittedError,
  InvalidArgumentError,
  InvalidPasswordError,
  KeyringCannotSignError,
  NotInitializedError,
} from '@/core/errors'
import { HardwareDeviceError, type IHardwareDevice } from '@/core/hardware'
import type { IHDWalletService } from '@/core/hdwallet'
import { KEYRING_TYPE, type KeyringType } from '@/core/keyring'
import type { IClock, ILogger } from '@/core/platform'
import { EXPORT_KIND, importedKeyScope, type ExportPermit } from '@/core/security'
import {
  SigningService,
  assertTypedDataMatchesChain,
  type ISigningService,
  type SignableMessage,
} from '@/core/signing'
import type { ISignableTransaction, ISignedTransaction, ITypedData } from '@/core/transaction'
import type {
  AccountId,
  Address,
  ChainId,
  DerivationPath,
  HexString,
  KeyringId,
  Unsubscribe,
} from '@/core/types'
import { toTxHash } from '@/core/types'

import { AccountRepository } from './AccountRepository'
import type { IAccountManager, IAccountRepository } from './contracts'
import {
  HD_KEYRING_ID,
  createAccountId,
  defaultAccountName,
  hardwareKeyringId,
  normalizeAccountName,
} from './identity'
import { ImportedKeyStore } from './ImportedKeyStore'
import type {
  AccountEventMap,
  IAccount,
  IAddHardwareAccountParams,
  ICreateAccountParams,
  IImportPrivateKeyParams,
} from './types'

const SERVICE_NAME = 'AccountManager'

/**
 * Creates a key-set identifier for an imported account.
 *
 * Each imported key forms its own set: it is tied neither to the HD
 * tree nor to other imported keys, and grouping them under a shared
 * identifier would assert a link that does not exist.
 */
function createImportedKeyringId(): KeyringId {
  return `imported-${createAccountId()}` as KeyringId
}

export interface IAccountManagerDependencies {
  readonly repository: IAccountRepository

  /** HD-account source. Derives addresses and performs signing. */
  readonly hdWallet: IHDWalletService

  /** Secure storage — for imported keys and password checks. */
  readonly secureStorage: ISecureStorage

  readonly clock: IClock
  readonly logger: ILogger

  /**
   * Connection to a hardware wallet on demand.
   *
   * A FUNCTION, NOT A READY OBJECT. The device is plugged in and
   * unplugged at any time, and the browser grants access to it only
   * on an explicit human action. Keeping the connection open
   * between operations would promise access that may already be
   * gone.
   *
   * Absence means a build without device support: signing with a
   * hardware account is then refused with a clear reason.
   */
  readonly connectHardware?: () => Promise<IHardwareDevice>
}

/**
 * Account management.
 *
 * State is held in memory: the UI needs the account list constantly,
 * and decrypting on every render is not allowed. Storage is read
 * once at `init()` and written on changes.
 *
 * RESPONSIBILITY BOUNDARY. The manager works with the public
 * projection of keys. Private keys of HD accounts stay inside
 * `HDWalletService` and do not go out; imported ones sit in
 * `ImportedKeyStore` encrypted. The only method that reveals a
 * secret is `exportPrivateKey`, and it requires two independent
 * confirmations.
 */
export class AccountManager implements IAccountManager {
  readonly #repository: IAccountRepository
  readonly #hdWallet: IHDWalletService
  readonly #secureStorage: ISecureStorage
  readonly #connectHardware: (() => Promise<IHardwareDevice>) | null
  readonly #importedKeys: ImportedKeyStore

  /* Signing with an imported key is done here: the key must not
     leave the module that owns it. For HD accounts signing stays
     inside `HDWalletService` for the same reason. */
  readonly #signing: ISigningService = new SigningService()
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #events = new EventBus<AccountEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Account event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  readonly #accounts = new Map<AccountId, IAccount>()

  #activeId: AccountId | null = null
  #initialized = false

  constructor(dependencies: IAccountManagerDependencies) {
    this.#repository = dependencies.repository
    this.#hdWallet = dependencies.hdWallet
    this.#secureStorage = dependencies.secureStorage
    this.#connectHardware = dependencies.connectHardware ?? null
    this.#importedKeys = new ImportedKeyStore(dependencies.secureStorage)
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  static create(dependencies: Omit<IAccountManagerDependencies, 'repository'>): AccountManager {
    return new AccountManager({
      ...dependencies,
      repository: new AccountRepository(dependencies.secureStorage),
    })
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return
    }

    for (const account of await this.#repository.findAll()) {
      this.#accounts.set(account.id, account)
    }

    const storedActive = await this.#repository.getActiveId()

    /* The stored choice may have pointed at a removed or hidden
       account. Fallback is the first visible one: the UI must not
       be left without a chosen sender. */
    this.#activeId =
      storedActive !== null && this.#isSelectable(storedActive)
        ? storedActive
        : (this.#firstSelectableId() ?? null)

    this.#initialized = true

    this.#logger.info('Accounts loaded', {
      total: this.#accounts.size,
      hasActive: this.#activeId !== null,
    })
  }

  list(): readonly IAccount[] {
    this.#assertInitialized()

    return [...this.#accounts.values()].sort((left, right) => left.order - right.order)
  }

  listVisible(): readonly IAccount[] {
    return this.list().filter((account) => !account.hidden)
  }

  getActive(): IAccount | null {
    this.#assertInitialized()

    return this.#activeId === null ? null : (this.#accounts.get(this.#activeId) ?? null)
  }

  getById(id: AccountId): IAccount | null {
    return this.#accounts.get(id) ?? null
  }

  getByAddress(address: Address): IAccount | null {
    /* Case-insensitive comparison: the same address appears in
       lowercase (RPC replies), uppercase, and EIP-55 checksum. A
       direct string compare would miss our own account. */
    return this.list().find((account) => areAddressesEqual(account.address, address)) ?? null
  }

  async setActive(id: AccountId): Promise<void> {
    const account = this.#requireAccount(id)

    if (account.hidden) {
      throw new InvalidArgumentError(
        'accountId',
        'a hidden account cannot be active: the owner would not see where the funds leave from',
      )
    }

    if (this.#activeId === id) {
      return
    }

    await this.#repository.setActiveId(id)
    this.#activeId = id

    this.#events.emit('account:activeChanged', { address: account.address })
  }

  async create(params: ICreateAccountParams = {}): Promise<IAccount> {
    this.#assertInitialized()

    /* The index is taken as the one after the maximum already
       created, not as the account count. An HD account cannot be
       deleted, but it can be hidden, and counting by quantity would
       reuse an index — two accounts with one address. */
    /* An explicit number comes from restore: there addresses were
       found in the tree, and there may be gaps between them.
       Without it the next free one is taken. */
    const addressIndex = params.addressIndex ?? this.#nextAddressIndex()
    const order = this.#accounts.size
    const account: IAccount = {
      id: createAccountId(),
      address: this.#hdWallet.getAddress(addressIndex),
      name: normalizeAccountName(params.name ?? defaultAccountName(order)),
      source: KEYRING_TYPE.Hd,
      keyringId: HD_KEYRING_ID,
      derivationPath: this.#hdWallet.deriveAccount(addressIndex).path,
      addressIndex,
      order,
      hidden: false,
      createdAt: this.#clock.now(),
    }

    await this.#persist(account)

    this.#logger.info('Account derived from the HD tree', { addressIndex })

    return account
  }

  async importPrivateKey(params: IImportPrivateKeyParams): Promise<IAccount> {
    this.#assertInitialized()

    /* The address is derived before saving: an unfit key must not
       enter storage even encrypted. */
    const address = privateKeyToAddress(params.privateKey)
    const existing = this.getByAddress(address)

    if (existing !== null) {
      throw new AccountAlreadyExistsError(address)
    }

    const order = this.#accounts.size
    const account: IAccount = {
      id: createAccountId(),
      address,
      name: normalizeAccountName(params.name ?? defaultAccountName(order)),
      source: KEYRING_TYPE.PrivateKey,
      /* Its own key set: an imported key does not belong to the HD
         tree and is not recovered from the seed phrase. */
      keyringId: createImportedKeyringId(),
      derivationPath: null,
      addressIndex: null,
      order,
      hidden: false,
      createdAt: this.#clock.now(),
    }

    await this.#importedKeys.save(account.id, params.privateKey)
    await this.#persist(account)

    this.#logger.warn('Private key imported', {
      note: 'the key cannot be restored from the seed phrase',
    })

    return account
  }

  async rename(id: AccountId, name: string): Promise<void> {
    const account = this.#requireAccount(id)

    await this.#persist({ ...account, name: normalizeAccountName(name) })
  }

  async setHidden(id: AccountId, hidden: boolean): Promise<void> {
    const account = this.#requireAccount(id)

    if (hidden && this.#activeId === id) {
      throw new InvalidArgumentError(
        'accountId',
        'the active account cannot be hidden: select another one first',
      )
    }

    if (hidden && this.listVisible().length <= 1) {
      throw new InvalidArgumentError('accountId', 'the last visible account cannot be hidden')
    }

    await this.#persist({ ...account, hidden })
  }

  async remove(id: AccountId, password: string): Promise<void> {
    const account = this.#requireAccount(id)

    if (account.source !== KEYRING_TYPE.PrivateKey) {
      /* An account from the HD tree will reappear on the next
         wallet restore from the same seed phrase. A "delete" button
         that in fact only hides the record misleads the user. */
      throw new AccountNotRemovableError(
        'the account is derived from the seed phrase and will reappear when the wallet is restored; hide it instead',
      )
    }

    if (!(await this.#secureStorage.verifyPassword(password))) {
      throw new InvalidPasswordError()
    }

    if (this.#activeId === id) {
      const replacement = this.list().find((candidate) => candidate.id !== id && !candidate.hidden)

      if (replacement === undefined) {
        throw new InvalidArgumentError(
          'accountId',
          'the only account of the wallet cannot be removed',
        )
      }

      await this.setActive(replacement.id)
    }

    /* The key is removed first: an orphaned account record without
       a key is visible and fixable, and an orphaned key without a
       record is invisible and will stay in storage forever. */
    await this.#importedKeys.remove(id)
    await this.#repository.delete(id)
    this.#accounts.delete(id)

    this.#logger.warn('Imported account removed together with its key', {
      note: 'the operation cannot be undone',
    })
    this.#emitListChanged()
  }

  async reorder(orderedIds: readonly AccountId[]): Promise<void> {
    this.#assertInitialized()

    if (orderedIds.length !== this.#accounts.size) {
      throw new InvalidArgumentError('orderedIds', 'the list must contain every existing account')
    }

    const reordered: IAccount[] = []

    orderedIds.forEach((id, order) => {
      reordered.push({ ...this.#requireAccount(id), order })
    })

    await this.#repository.saveAll(reordered)

    for (const account of reordered) {
      this.#accounts.set(account.id, account)
    }

    this.#emitListChanged()
  }

  /**
   * Signs a transaction with the account key.
   *
   * THE ONLY SIGNING PATH FOR BOTH KEY SOURCES. An HD account signs
   * inside `HDWalletService`, where the key is derived and wiped
   * without leaving the module. An imported key is loaded here,
   * passed into signing, and wiped in `finally` — it does not go
   * out in any case.
   *
   * NO PASSWORD IS REQUIRED, UNLIKE EXPORT. Export gives the key to
   * the user forever; signing performs an action the user has just
   * confirmed on screen. Requiring a password on every signature
   * would train them to type it mechanically — and devalue the
   * requirement where it truly protects.
   *
   * @throws AccountNotFoundError, KeyringCannotSignError
   */
  async signTransaction(
    id: AccountId,
    transaction: ISignableTransaction,
  ): Promise<ISignedTransaction> {
    const account = this.#requireAccount(id)

    if (account.source === KEYRING_TYPE.PrivateKey) {
      /* Wiping is expressed as a construct, not a `try/finally`
         pair: a forgotten `finally` gives neither a compile error
         nor a failing test — it silently leaves the private key in
         memory. */
      return withSecretSync(await this.#importedKeys.load(id), (key) =>
        this.#signing.signTransaction(transaction, key),
      )
    }

    if (isHardware(account.source)) {
      return await this.#signOnDevice(account, (device, path) =>
        device.signTransaction(path, transaction),
      ).then((raw) => ({
        raw,
        hash: toTxHash(keccak256(raw)),
        transaction,
      }))
    }

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signTransaction(account.addressIndex, transaction)
  }

  /**
   * Signs an arbitrary message per EIP-191.
   *
   * The path is the same as for a transaction: an imported key is
   * signed here and wiped at once, an HD-account key does not leave
   * `HDWalletService`.
   *
   * @throws AccountNotFoundError, KeyringCannotSignError
   */
  async signMessage(id: AccountId, message: SignableMessage): Promise<HexString> {
    const account = this.#requireAccount(id)

    if (account.source === KEYRING_TYPE.PrivateKey) {
      return withSecretSync(await this.#importedKeys.load(id), (key) =>
        this.#signing.signMessage(message, key),
      )
    }

    if (isHardware(account.source)) {
      return await this.#signOnDevice(account, (device, path) =>
        device.signMessage(path, toMessageBytes(message)),
      )
    }

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signMessage(account.addressIndex, message)
  }

  /**
   * Signs structured data per EIP-712.
   *
   * MORE DANGEROUS THAN TRANSACTION SIGNING. The signed structure
   * is presented to a contract later and does not appear in the
   * wallet's operation history: the owner will see neither a debit
   * nor a fee. The network is checked mandatorily — a signature
   * made for a foreign chain may be valid where it was not
   * expected.
   *
   * @throws AccountNotFoundError, KeyringCannotSignError,
   *         InvalidArgumentError on a network mismatch.
   */
  async signTypedData(
    id: AccountId,
    data: ITypedData,
    expectedChainId: ChainId,
  ): Promise<HexString> {
    const account = this.#requireAccount(id)

    if (account.source === KEYRING_TYPE.PrivateKey) {
      return withSecretSync(await this.#importedKeys.load(id), (key) =>
        this.#signing.signTypedData(data, key, expectedChainId),
      )
    }

    if (isHardware(account.source)) {
      /* The network is checked here: the device will get two ready
         hashes and will no longer be able to check the domain. */
      assertTypedDataMatchesChain(data, expectedChainId)

      return await this.#signOnDevice(account, (device, path) => device.signTypedData(path, data))
    }

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signTypedData(account.addressIndex, data, expectedChainId)
  }

  /**
   * Performs a signing operation on the device.
   *
   * THE ADDRESS IS CHECKED BEFORE SIGNING. The device signs with
   * the key that sits at the given path; we store the path, and the
   * path-to-address link was set when the account was added. If the
   * person plugs in another device — a different key sits at the
   * same path, and the signature would go out under a foreign name.
   * The check costs one request and removes that case entirely.
   */
  async #signOnDevice<TResult>(
    account: IAccount,
    operation: (device: IHardwareDevice, path: DerivationPath) => Promise<TResult>,
  ): Promise<TResult> {
    if (this.#connectHardware === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    const path = account.derivationPath

    if (path === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    const device = await this.#connectHardware()
    const onDevice = await device.getAddress(path)

    if (!areAddressesEqual(onDevice.address, account.address)) {
      throw new HardwareDeviceError(
        'the connected device holds a different address at this path: it is not the device this account was added from',
      )
    }

    return await operation(device, path)
  }

  /**
   * Adds a hardware-wallet account.
   *
   * THERE IS NO SECRET HERE AND CANNOT BE. Only the address and
   * path are saved; the key stays in the device, and without it the
   * account will sign nothing. That is why such an account can be
   * deleted for real, unlike one derived from the seed phrase.
   */
  async addHardwareAccount(params: IAddHardwareAccountParams): Promise<IAccount> {
    this.#assertInitialized()

    const existing = this.getByAddress(params.address)

    if (existing !== null) {
      throw new AccountAlreadyExistsError(params.address)
    }

    const order = this.#accounts.size
    const account: IAccount = {
      id: createAccountId(),
      address: params.address,
      name: normalizeAccountName(params.name ?? defaultAccountName(order)),
      source: params.type,
      keyringId: hardwareKeyringId(params.type),
      derivationPath: params.path,
      /* It has no index in our tree: the tree lives in the device. */
      addressIndex: null,
      order,
      hidden: false,
      createdAt: this.#clock.now(),
    }

    await this.#persist(account)

    this.#logger.info('A hardware wallet account was added', { path: params.path })

    return account
  }

  async exportPrivateKey(
    id: AccountId,
    password: string,
    permit: ExportPermit,
  ): Promise<ISecretBuffer> {
    const account = this.#requireAccount(id)

    /* The password is checked even when the lock is off. An
       unlocked lock only means the password was entered at some
       point, not that the owner is at the device now. */
    if (!(await this.#secureStorage.verifyPassword(password))) {
      throw new InvalidPasswordError()
    }

    if (account.source === KEYRING_TYPE.PrivateKey) {
      /* The permit for an imported key is consumed here: it has no
         index in the HD tree, so `HDWalletService` will not check
         it. */
      if (!permit.matches(EXPORT_KIND.PrivateKey, importedKeyScope(account.keyringId), null)) {
        throw new ExportNotPermittedError('the permit was issued for a different operation')
      }

      permit.consume()

      return await this.#importedKeys.load(id)
    }

    if (account.addressIndex === null) {
      throw new ExportNotPermittedError(
        `an account of type "${account.source}" holds no extractable private key`,
      )
    }

    return this.#hdWallet.exportPrivateKey(account.addressIndex, permit)
  }

  on<TName extends keyof AccountEventMap>(
    event: TName,
    listener: EventListener<AccountEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof AccountEventMap>(
    event: TName,
    listener: EventListener<AccountEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof AccountEventMap>(
    event: TName,
    listener: EventListener<AccountEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  async #persist(account: IAccount): Promise<void> {
    await this.#repository.save(account)
    this.#accounts.set(account.id, account)

    if (this.#activeId === null && !account.hidden) {
      await this.#repository.setActiveId(account.id)
      this.#activeId = account.id
      this.#events.emit('account:activeChanged', { address: account.address })
    }

    this.#emitListChanged()
  }

  /**
   * Next free address index in the HD tree.
   *
   * Maximum used plus one. Hidden accounts are counted: their
   * addresses exist and may hold funds.
   */
  #nextAddressIndex(): number {
    let maximum = -1

    for (const account of this.#accounts.values()) {
      if (account.addressIndex !== null && account.addressIndex > maximum) {
        maximum = account.addressIndex
      }
    }

    return maximum + 1
  }

  #isSelectable(id: AccountId): boolean {
    const account = this.#accounts.get(id)

    return account !== undefined && !account.hidden
  }

  #firstSelectableId(): AccountId | undefined {
    return [...this.#accounts.values()]
      .sort((left, right) => left.order - right.order)
      .find((account) => !account.hidden)?.id
  }

  #requireAccount(id: AccountId): IAccount {
    this.#assertInitialized()

    const account = this.#accounts.get(id)

    if (account === undefined) {
      throw new AccountNotFoundError(id)
    }

    return account
  }

  #emitListChanged(): void {
    this.#events.emit('account:listChanged', {
      accounts: this.listVisible().map((account) => account.address),
    })
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new NotInitializedError(SERVICE_NAME)
    }
  }
}

/**
 * Whether the account key lives in a separate device.
 *
 * Check by source type, not by missing index: a watched account
 * also has no index, but it cannot sign with anything.
 */
function isHardware(source: KeyringType): boolean {
  return source === KEYRING_TYPE.Ledger || source === KEYRING_TYPE.Trezor
}

/**
 * Converts a message to bytes.
 *
 * A string is encoded as UTF-8 — the same way as inside
 * `personal_sign`. Otherwise the signature would fall on different
 * bytes than a software-key signature, and two accounts of one
 * wallet would give different signatures of the same message.
 */
function toMessageBytes(message: SignableMessage): Uint8Array {
  return typeof message === 'string' ? toUtf8Bytes(message) : Uint8Array.from(message)
}
