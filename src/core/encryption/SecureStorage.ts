import { utf8ToBytes } from '@noble/hashes/utils.js'

import {
  InvalidPasswordError,
  VaultCorruptedError,
  WalletAlreadyInitializedError,
  WalletLockedError,
  WalletNotInitializedError,
} from '@/core/errors'
import {
  STORAGE_NAMESPACE,
  toStorageKey,
  type IStorageService,
  type StorageKey,
  type StorageNamespace,
} from '@/core/storage'

import type { IEncryptionService, ISecureStorage } from './contracts'
import type { EncryptionKey } from './EncryptionKey'
import { PAYLOAD_VERSION } from './parameters'
import { decodePayload, encodePayload, type IEncryptedPayloadRecord } from './payload-codec'
import type { IEncryptedPayload, IKdfParams } from './types'

/** Ключ заголовка хранилища в пространстве настроек. */
const HEADER_KEY: StorageKey = toStorageKey('secure-storage.header')

/**
 * Проверочная строка.
 *
 * Шифруется при инициализации и расшифровывается при разблокировке.
 * Позволяет отличить неверный пароль от повреждённых пользовательских
 * данных, не трогая сами данные.
 *
 * Известный злоумышленнику открытый текст опасности не представляет:
 * AES-GCM устойчив к атаке на основе известного открытого текста,
 * а стойкость к перебору пароля определяется параметрами KDF, а не
 * секретностью проверочного значения.
 */
const VERIFIER_PLAINTEXT = 'wallet.secure-storage.v1'

/** Признак записи, зашифрованной этим слоем. */
const ENVELOPE_MARKER = 'enc' as const

/** Зашифрованная запись в нижележащем хранилище. */
interface IEncryptedEnvelope {
  readonly __type: typeof ENVELOPE_MARKER
  readonly payload: IEncryptedPayloadRecord
}

/** Заголовок хранилища. Секретов не содержит. */
interface ISecureStorageHeader {
  readonly version: number
  readonly kdf: IEncryptedPayloadRecord['kdf']
  readonly verifier: IEncryptedPayloadRecord
}

function isEncryptedEnvelope(value: unknown): value is IEncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<IEncryptedEnvelope>).__type === ENVELOPE_MARKER
  )
}

/**
 * Хранилище с прозрачным шифрованием записей.
 *
 * УСТРОЙСТВО. Соль одна на всё хранилище и лежит в заголовке; вектор
 * инициализации свой у каждой записи. Сессионный ключ выводится один раз
 * при разблокировке и живёт до блокировки.
 *
 * Почему не выводить ключ на каждую операцию: PBKDF2 с 600 000 итераций
 * занимает сотни миллисекунд. Чтение списка аккаунтов при открытии экрана
 * заняло бы секунды, и пользователь получил бы неработоспособное приложение.
 * Стойкость от этого не страдает: перебор пароля всё равно упирается
 * в стоимость одного вывода ключа.
 *
 * ГАРАНТИЯ. Значение, прошедшее через `set`, попадает в нижележащее
 * хранилище только внутри конверта с шифротекстом. Открытого представления
 * не сохраняется нигде и никогда.
 *
 * ЧЕГО СЛОЙ НЕ СКРЫВАЕТ: имена пространств и ключей, число записей
 * и приблизительный размер значений. Наблюдатель с доступом к хранилищу
 * узнает, сколько у пользователя аккаунтов, но не узнает ни адресов,
 * ни ключей.
 *
 * ОГРАНИЧЕНИЕ ПО ТИПАМ. Значения сериализуются через JSON, поэтому
 * `bigint` напрямую не поддерживается: `JSON.stringify` на нём выбрасывает
 * исключение. Денежные величины преобразуются в строку на уровне
 * репозитория — так же, как это сделано для `chainId` в модуле сетей.
 */
export class SecureStorage implements ISecureStorage {
  readonly #storage: IStorageService
  readonly #encryption: IEncryptionService

  #sessionKey: EncryptionKey | null = null
  #kdfParams: IKdfParams | null = null

  constructor(storage: IStorageService, encryption: IEncryptionService) {
    this.#storage = storage
    this.#encryption = encryption
  }

  get isUnlocked(): boolean {
    return this.#sessionKey !== null
  }

  async isInitialized(): Promise<boolean> {
    return (await this.#readHeader()) !== null
  }

  async initialize(password: string): Promise<void> {
    if (await this.isInitialized()) {
      throw new WalletAlreadyInitializedError()
    }

    const kdfParams = this.#encryption.createKdfParams()
    const key = await this.#encryption.deriveKey(password, kdfParams)

    const verifier = await this.#encryption.encryptWithKey(
      utf8ToBytes(VERIFIER_PLAINTEXT),
      key,
      kdfParams,
    )

    const header: ISecureStorageHeader = {
      version: PAYLOAD_VERSION,
      kdf: encodePayload(verifier).kdf,
      verifier: encodePayload(verifier),
    }

    await this.#storage.set(STORAGE_NAMESPACE.Settings, HEADER_KEY, header)

    this.#sessionKey = key
    this.#kdfParams = kdfParams
  }

  async unlock(password: string): Promise<void> {
    const header = await this.#readHeader()

    if (header === null) {
      throw new WalletNotInitializedError()
    }

    const verifier = decodePayload(header.verifier)
    const key = await this.#encryption.deriveKey(password, verifier.kdf)

    let decrypted

    try {
      decrypted = await this.#encryption.decryptWithKey(verifier, key)
    } catch {
      key.destroy()

      /* Расшифровка проверочного блока не удалась. Причина не уточняется:
         отличие «неверный пароль» от «заголовок повреждён» — информация
         для подбирающего пароль. */
      throw new InvalidPasswordError()
    }

    decrypted.wipe()

    this.#sessionKey = key
    this.#kdfParams = verifier.kdf
  }

  async verifyPassword(password: string): Promise<boolean> {
    const header = await this.#readHeader()

    if (header === null) {
      return false
    }

    const verifier = decodePayload(header.verifier)
    const key = await this.#encryption.deriveKey(password, verifier.kdf)

    try {
      ;(await this.#encryption.decryptWithKey(verifier, key)).wipe()

      return true
    } catch {
      return false
    } finally {
      /* Проверочный ключ уничтожается в любом случае: он не должен
         пережить проверку и остаться доступным вызывающему коду. */
      key.destroy()
    }
  }

  lock(): void {
    this.#sessionKey?.destroy()
    this.#sessionKey = null
    this.#kdfParams = null
  }

  async get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null> {
    const session = this.#requireUnlocked()
    const stored = await this.#storage.get<unknown>(namespace, key)

    if (stored === null) {
      return null
    }

    if (!isEncryptedEnvelope(stored)) {
      /* Запись есть, но она не зашифрована этим слоем. Молча вернуть её
         нельзя: это означало бы, что секрет когда-то был записан в обход
         шифрования, и такое состояние обязано быть замечено. */
      throw new VaultCorruptedError(`запись "${key}" не зашифрована`)
    }

    const plaintext = await this.#encryption.decryptWithKey(decodePayload(stored.payload), session)

    try {
      return JSON.parse(new TextDecoder().decode(plaintext.bytes)) as TValue
    } finally {
      plaintext.wipe()
    }
  }

  async set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void> {
    const session = this.#requireUnlocked()

    await this.#storage.set(namespace, key, await this.#seal(value, session))
  }

  async remove(namespace: StorageNamespace, key: StorageKey): Promise<void> {
    await this.#storage.remove(namespace, key)
  }

  async has(namespace: StorageNamespace, key: StorageKey): Promise<boolean> {
    return await this.#storage.has(namespace, key)
  }

  async keys(namespace: StorageNamespace): Promise<readonly StorageKey[]> {
    return await this.#storage.keys(namespace)
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const header = await this.#readHeader()

    if (header === null) {
      throw new WalletNotInitializedError()
    }

    const verifier = decodePayload(header.verifier)
    const currentKey = await this.#encryption.deriveKey(currentPassword, verifier.kdf)

    try {
      await this.#assertPasswordMatches(verifier, currentKey)

      const nextParams = this.#encryption.createKdfParams()
      const nextKey = await this.#encryption.deriveKey(newPassword, nextParams)

      try {
        await this.#reencryptAll(currentKey, nextKey, nextParams)

        /* Ключ сессии подменяется только после успешной перезаписи:
           при сбое хранилище остаётся под прежним паролем, а сессия —
           в согласованном с ним состоянии. */
        this.#sessionKey?.destroy()
        this.#sessionKey = await this.#encryption.deriveKey(newPassword, nextParams)
        this.#kdfParams = nextParams
      } finally {
        nextKey.destroy()
      }
    } finally {
      currentKey.destroy()
    }
  }

  async destroy(): Promise<void> {
    this.lock()

    for (const namespace of Object.values(STORAGE_NAMESPACE)) {
      await this.#storage.clear(namespace)
    }
  }

  /**
   * Перешифровывает все записи и обновляет заголовок.
   *
   * Выполняется одной транзакцией. Частичная перезапись оставила бы часть
   * записей под старым ключом, а часть под новым — такое хранилище
   * не открылось бы ни одним паролем.
   */
  async #reencryptAll(
    currentKey: EncryptionKey,
    nextKey: EncryptionKey,
    nextParams: IKdfParams,
  ): Promise<void> {
    const namespaces = Object.values(STORAGE_NAMESPACE)

    /* Перешифровка выполняется до открытия транзакции: криптографические
       операции асинхронны, а транзакция IndexedDB закрывается при первом
       же обороте цикла событий без обращения к ней. */
    const rewritten: { namespace: StorageNamespace; key: StorageKey; value: unknown }[] = []

    for (const namespace of namespaces) {
      for (const key of await this.#storage.keys(namespace)) {
        const stored = await this.#storage.get<unknown>(namespace, key)

        if (!isEncryptedEnvelope(stored)) {
          continue
        }

        const plaintext = await this.#encryption.decryptWithKey(
          decodePayload(stored.payload),
          currentKey,
        )

        try {
          const resealed = await this.#encryption.encryptWithKey(
            plaintext.bytes,
            nextKey,
            nextParams,
          )

          rewritten.push({
            namespace,
            key,
            value: { __type: ENVELOPE_MARKER, payload: encodePayload(resealed) },
          })
        } finally {
          plaintext.wipe()
        }
      }
    }

    const verifier = await this.#encryption.encryptWithKey(
      utf8ToBytes(VERIFIER_PLAINTEXT),
      nextKey,
      nextParams,
    )

    const header: ISecureStorageHeader = {
      version: PAYLOAD_VERSION,
      kdf: encodePayload(verifier).kdf,
      verifier: encodePayload(verifier),
    }

    await this.#storage.transaction(namespaces, async (transaction) => {
      for (const entry of rewritten) {
        await transaction.set(entry.namespace, entry.key, entry.value)
      }

      await transaction.set(STORAGE_NAMESPACE.Settings, HEADER_KEY, header)
    })
  }

  async #assertPasswordMatches(verifier: IEncryptedPayload, key: EncryptionKey): Promise<void> {
    try {
      ;(await this.#encryption.decryptWithKey(verifier, key)).wipe()
    } catch {
      throw new InvalidPasswordError()
    }
  }

  async #seal<TValue>(value: TValue, key: EncryptionKey): Promise<IEncryptedEnvelope> {
    const plaintext = utf8ToBytes(JSON.stringify(value))

    try {
      const payload = await this.#encryption.encryptWithKey(
        plaintext,
        key,
        this.#requireKdfParams(),
      )

      return { __type: ENVELOPE_MARKER, payload: encodePayload(payload) }
    } finally {
      /* Открытое представление значения затирается сразу: оно могло
         содержать приватный ключ либо мнемоническую фразу. */
      plaintext.fill(0)
    }
  }

  async #readHeader(): Promise<ISecureStorageHeader | null> {
    return await this.#storage.get<ISecureStorageHeader>(STORAGE_NAMESPACE.Settings, HEADER_KEY)
  }

  #requireUnlocked(): EncryptionKey {
    if (this.#sessionKey === null) {
      throw new WalletLockedError('доступ к зашифрованному хранилищу')
    }

    return this.#sessionKey
  }

  #requireKdfParams(): IKdfParams {
    if (this.#kdfParams === null) {
      throw new WalletLockedError('доступ к параметрам шифрования')
    }

    return this.#kdfParams
  }
}
