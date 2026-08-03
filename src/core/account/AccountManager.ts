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
import type { IHDWalletService } from '@/core/hdwallet'
import { KEYRING_TYPE } from '@/core/keyring'
import type { IClock, ILogger } from '@/core/platform'
import { EXPORT_KIND, importedKeyScope, type ExportPermit } from '@/core/security'
import { SigningService, type ISigningService, type SignableMessage } from '@/core/signing'
import type { ISignableTransaction, ISignedTransaction, ITypedData } from '@/core/transaction'
import type { AccountId, Address, ChainId, HexString, KeyringId, Unsubscribe } from '@/core/types'

import { AccountRepository } from './AccountRepository'
import type { IAccountManager, IAccountRepository } from './contracts'
import {
  HD_KEYRING_ID,
  createAccountId,
  defaultAccountName,
  normalizeAccountName,
} from './identity'
import { ImportedKeyStore } from './ImportedKeyStore'
import type {
  AccountEventMap,
  IAccount,
  ICreateAccountParams,
  IImportPrivateKeyParams,
} from './types'

const SERVICE_NAME = 'AccountManager'

/**
 * Создаёт идентификатор набора ключей для импортированного аккаунта.
 *
 * Каждый импортированный ключ образует собственный набор: он не связан
 * ни с HD-деревом, ни с другими импортированными ключами, и объединять
 * их под общим идентификатором значило бы утверждать несуществующую связь.
 */
function createImportedKeyringId(): KeyringId {
  return `imported-${createAccountId()}` as KeyringId
}

/** Зависимости менеджера. Внедряются конструктором. */
export interface IAccountManagerDependencies {
  readonly repository: IAccountRepository

  /** Источник HD-аккаунтов. Выводит адреса и выполняет подпись. */
  readonly hdWallet: IHDWalletService

  /** Защищённое хранилище — для импортированных ключей и проверки пароля. */
  readonly secureStorage: ISecureStorage

  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Управление аккаунтами.
 *
 * Состояние держится в памяти: список аккаунтов нужен интерфейсу постоянно,
 * а обращение к расшифровке на каждый рендер недопустимо. Хранилище
 * читается один раз при `init()` и пишется при изменениях.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ. Менеджер работает с публичной проекцией ключей.
 * Приватные ключи HD-аккаунтов остаются внутри `HDWalletService` и наружу
 * не выходят; импортированные лежат в `ImportedKeyStore` зашифрованными.
 * Единственный метод, выдающий секрет, — `exportPrivateKey`, и он требует
 * двух независимых подтверждений.
 */
export class AccountManager implements IAccountManager {
  readonly #repository: IAccountRepository
  readonly #hdWallet: IHDWalletService
  readonly #secureStorage: ISecureStorage
  readonly #importedKeys: ImportedKeyStore

  /* Подпись импортированным ключом выполняется здесь же: ключ не должен
     покидать модуль, владеющий им. Для HD-аккаунтов подпись остаётся
     внутри `HDWalletService` по той же причине. */
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
    this.#importedKeys = new ImportedKeyStore(dependencies.secureStorage)
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  /** Собирает менеджер с репозиторием по умолчанию поверх защищённого хранилища. */
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

    /* Сохранённый выбор мог указывать на удалённый либо скрытый аккаунт.
       Запасной вариант — первый видимый: интерфейс не должен остаться
       без выбранного отправителя. */
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
    /* Сравнение без учёта регистра: один и тот же адрес встречается
       в нижнем регистре (ответы RPC), в верхнем и в контрольной сумме
       EIP-55. Прямое сравнение строк не нашло бы собственный аккаунт. */
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

    /* Индекс берётся как следующий за максимальным из уже созданных,
       а не как число аккаунтов. Удалить HD-аккаунт нельзя, но можно
       скрыть, и подсчёт по количеству дал бы повторный индекс — два
       аккаунта с одним адресом. */
    const addressIndex = this.#nextAddressIndex()
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

    /* Адрес выводится до сохранения: непригодный ключ не должен попасть
       в хранилище даже зашифрованным. */
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
      /* Собственный набор ключей: импортированный ключ не принадлежит
         HD-дереву и не восстанавливается из seed-фразы. */
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
      /* Аккаунт из HD-дерева появится снова при следующем восстановлении
         кошелька по той же seed-фразе. Кнопка «удалить», которая на деле
         лишь прячет запись, вводит пользователя в заблуждение. */
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

    /* Ключ удаляется первым: осиротевшая запись аккаунта без ключа
       заметна и исправима, а осиротевший ключ без записи невидим
       и останется в хранилище навсегда. */
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
   * Подписывает транзакцию ключом аккаунта.
   *
   * ЕДИНСТВЕННЫЙ ПУТЬ ПОДПИСИ ДЛЯ ОБОИХ ИСТОЧНИКОВ КЛЮЧЕЙ. HD-аккаунт
   * подписывает внутри `HDWalletService`, где ключ выводится и затирается
   * не покидая модуля. Импортированный ключ загружается здесь, передаётся
   * в подпись и затирается в `finally` — наружу он не выходит ни в каком
   * случае.
   *
   * ПАРОЛЬ НЕ ТРЕБУЕТСЯ, В ОТЛИЧИЕ ОТ ЭКСПОРТА. Экспорт выдаёт ключ
   * пользователю навсегда, подпись же выполняет действие, которое
   * пользователь только что подтвердил на экране. Требовать пароль
   * на каждую подпись значило бы приучить вводить его machinally —
   * и обесценить требование там, где оно защищает по-настоящему.
   *
   * @throws AccountNotFoundError, KeyringCannotSignError
   */
  async signTransaction(
    id: AccountId,
    transaction: ISignableTransaction,
  ): Promise<ISignedTransaction> {
    const account = this.#requireAccount(id)

    if (account.source === KEYRING_TYPE.PrivateKey) {
      /* Затирание выражено конструкцией, а не парой `try/finally`:
         забытый `finally` не даёт ни ошибки компиляции, ни падения
         теста — он молча оставляет приватный ключ в памяти. */
      return withSecretSync(await this.#importedKeys.load(id), (key) =>
        this.#signing.signTransaction(transaction, key),
      )
    }

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signTransaction(account.addressIndex, transaction)
  }

  /**
   * Подписывает произвольное сообщение по EIP-191.
   *
   * Путь тот же, что у транзакции: импортированный ключ подписывается
   * здесь и затирается сразу, ключ HD-аккаунта не покидает
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

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signMessage(account.addressIndex, message)
  }

  /**
   * Подписывает структурированные данные по EIP-712.
   *
   * ОПАСНЕЕ ПОДПИСИ ТРАНЗАКЦИИ. Подписанная структура предъявляется
   * контракту позже и в истории операций кошелька не отражается:
   * владелец не увидит ни списания, ни комиссии. Сеть сверяется
   * обязательно — подпись, сделанная для чужой цепи, может оказаться
   * действительной там, где её не ждали.
   *
   * @throws AccountNotFoundError, KeyringCannotSignError,
   *         InvalidArgumentError при несовпадении сети.
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

    if (account.addressIndex === null) {
      throw new KeyringCannotSignError(account.keyringId)
    }

    return this.#hdWallet.signTypedData(account.addressIndex, data, expectedChainId)
  }

  async exportPrivateKey(
    id: AccountId,
    password: string,
    permit: ExportPermit,
  ): Promise<ISecretBuffer> {
    const account = this.#requireAccount(id)

    /* Пароль проверяется даже при снятой блокировке. Снятая блокировка
       означает лишь, что пароль вводили когда-то, а не что за устройством
       сейчас владелец. */
    if (!(await this.#secureStorage.verifyPassword(password))) {
      throw new InvalidPasswordError()
    }

    if (account.source === KEYRING_TYPE.PrivateKey) {
      /* Разрешение для импортированного ключа гасится здесь: у него нет
         индекса в HD-дереве, поэтому `HDWalletService` его не проверит. */
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

  /** Сохраняет аккаунт, обновляет память и назначает активным первый созданный. */
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
   * Следующий свободный индекс адреса в HD-дереве.
   *
   * Максимальный использованный плюс один. Скрытые аккаунты учитываются:
   * их адреса существуют и могут содержать средства.
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
