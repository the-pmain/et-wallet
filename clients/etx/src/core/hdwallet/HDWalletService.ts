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
 * Предел числа запомненных публичных проекций адресов.
 *
 * Кошельку с сотней аккаунтов кэш всё ещё помогает, а перебор индексов
 * посторонним кодом на нём останавливается.
 */
const MAX_CACHED_ACCOUNTS = 256

const SERVICE_NAME = 'HDWalletService'

/** Минимальная длина seed по BIP-32. */
const MIN_SEED_LENGTH = 16

/** Максимальная длина seed по BIP-32. */
const MAX_SEED_LENGTH = 64

/**
 * Реализация HD-кошелька поверх `@scure/bip32`.
 *
 * УСТРОЙСТВО. Экземпляр хранит два узла дерева:
 * - узел аккаунта `m/44'/60'/0'` — из него экспортируются расширенные ключи;
 * - узел цепочки `m/44'/60'/0'/0` — от него выводятся адреса.
 *
 * Оба вычисляются один раз при создании. Дальнейшая деривация адреса —
 * один несмягчённый шаг от узла цепочки, а не пять шагов от корня. Разница
 * существенна: закалённая деривация дороже, а список из двадцати адресов
 * строится при каждом открытии экрана аккаунтов.
 *
 * Корневой узел после вычисления этих двух НЕ сохраняется: держать в памяти
 * ключ от всего дерева, когда нужен ключ от одной его ветви, — расширение
 * периметра секретов без выгоды.
 */
export class HDWalletService implements IHDWalletService {
  readonly accountPath: DerivationPath

  readonly #changePath: DerivationPath

  /* Подпись — единственная операция, ради которой нужен приватный ключ.
     Держать её здесь позволяет ключу не покидать модуль вовсе. */
  readonly #signing: ISigningService = new SigningService()

  /**
   * Кэш ПУБЛИЧНОЙ проекции адресов.
   *
   * ЧТО ЗДЕСЬ ЛЕЖИТ И ЧЕГО ЗДЕСЬ НЕТ. Адрес, публичный ключ и путь —
   * то, что и так показывается на экране. Узлов `HDKey` тут нет
   * намеренно: узел хранит приватный ключ, и кэшировать его значило бы
   * держать в памяти ровно то, что весь остальной код старается
   * не удерживать. Подпись всегда выводит ключ заново и затирает его —
   * ускорять эту дорогу нельзя.
   *
   * Очищается в `wipe()` вместе с ключами: адреса не секрет, но
   * пережившая блокировку карта адресов сообщает наблюдателю, чем
   * пользовались.
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
   * Создаёт кошелёк из двоичного seed BIP-39.
   *
   * @param seed 16..64 байта. Владение НЕ передаётся: буфер остаётся
   *        за вызывающим, и затирать его обязан он.
   * @throws InvalidArgumentError при недопустимой длине seed.
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
      /* Корневой ключ больше не нужен: оба требуемых узла получены.
         Держать его в памяти означало бы хранить доступ ко всему дереву
         ради доступа к одной ветви. */
      root.wipePrivateData()
    }
  }

  /**
   * Создаёт кошелёк из расширенного ключа уровня АККАУНТА.
   *
   * Принимается и xprv, и xpub. Во втором случае экземпляр работает
   * в режиме наблюдения: адреса выводятся, приватные ключи недоступны.
   * Именно этот режим соответствует типу набора ключей `WatchOnly`.
   *
   * @throws InvalidExtendedKeyError если строка не разбирается либо
   *         не соответствует уровню аккаунта.
   */
  static fromAccountExtendedKey(
    extendedKey: string,
    options: IHDWalletOptions = {},
  ): HDWalletService {
    let accountNode: HDKey

    try {
      accountNode = HDKey.fromExtendedKey(extendedKey)
    } catch (error) {
      /* Текст исключения библиотеки не пробрасывается: в него может попасть
         фрагмент разбираемого ключа, а xprv является секретом. */
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

    /* Предел на всякий случай: перебор индексов внешним кодом иначе
       наращивал бы карту неограниченно. Записи сверх предела просто
       не запоминаются — деривация от этого не ломается. */
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

    /* Путь задаётся от корня, а корневой ключ намеренно не сохранён.
       Поэтому производится деривация относительно узла аккаунта: у HDKey
       путь, начинающийся с `m`, требует именно корневого узла. */
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

    /* Расширенный ключ представлен строкой base58: она неочищаема, как
       и любая строка в JavaScript. Перевод в буфер ограничивает утечку
       одним значением, но не устраняет её. */
    return SecretBuffer.fromUtf8(node.privateExtendedKey)
  }

  /**
   * Внутренний доступ к публичному ключу узла аккаунта.
   *
   * Нужен, чтобы построить xpub для оценки риска БЕЗ фактической выдачи
   * секрета. Значение не покидает ядро.
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
   * Выполняет операцию с приватным ключом и гарантированно затирает его.
   *
   * Ключ существует только на время вызова обработчика и никогда
   * не покидает модуль. Затирание в `finally` срабатывает и при
   * исключении внутри подписи.
   *
   * До этого метода существовал публичный `getPrivateKeyForSigning`,
   * отдававший ключ наружу. Он удалён: подпись — единственное, ради
   * чего ключ нужен, и выполнять её следует там, где ключ уже есть.
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

    /* Копия, а не передача владения: `privateKey` — внутренний буфер узла
       HDKey. Затирание возвращённого буфера вызывающим кодом не должно
       разрушать состояние дерева. */
    return SecretBuffer.copyOf(privateKey)
  }

  /**
   * Проверяет разрешение и помечает его использованным.
   *
   * Порядок важен: разрешение гасится ДО выдачи секрета. Исключение
   * при выдаче не должно оставлять действующее разрешение — иначе
   * повторная попытка обошла бы подтверждение пользователя.
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

  /** Относительный путь от узла аккаунта до узла цепочки, например `0`. */
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

  /** Отрезает от полного пути префикс уровня аккаунта. */
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
