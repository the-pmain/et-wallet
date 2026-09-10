import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { assertValidPrivateKey } from '@/core/address'
import { SecretBuffer, type ISecretBuffer, type ISecureStorage } from '@/core/encryption'
import { AccountNotFoundError, VaultCorruptedError } from '@/core/errors'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { AccountId } from '@/core/types'

/** Префикс ключей хранилища, отделяющий импортированные ключи от прочего. */
const KEY_PREFIX = 'imported-key.'

/**
 * Хранилище импортированных приватных ключей.
 *
 * ОТЛИЧИЕ ОТ HD-АККАУНТОВ, определяющее всё поведение: ключ, попавший сюда,
 * существует в единственном экземпляре. Из seed-фразы он не выводится,
 * при восстановлении кошелька не появится. Его потеря окончательна.
 *
 * Отсюда два следствия:
 * - удаление требует подтверждения паролем на уровне выше;
 * - запись выполняется только через `ISecureStorage`, то есть всегда
 *   в зашифрованном виде.
 *
 * Ключ хранится шестнадцатеричной строкой: `SecureStorage` сериализует
 * значения через JSON, где `Uint8Array` превращается в объект с числовыми
 * ключами и молча портится. Строка на короткое время существует в куче
 * неочищаемой — ограничение, общее для всей работы с секретами
 * в JavaScript.
 */
export class ImportedKeyStore {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  /**
   * Сохраняет ключ, привязав его к аккаунту.
   *
   * Владение переданным буфером НЕ принимается: вызывающий затирает его сам.
   */
  async save(accountId: AccountId, privateKey: ISecretBuffer): Promise<void> {
    assertValidPrivateKey(privateKey.bytes)

    await this.#storage.set(
      STORAGE_NAMESPACE.Vault,
      ImportedKeyStore.#keyOf(accountId),
      bytesToHex(privateKey.bytes),
    )
  }

  /**
   * Читает ключ аккаунта.
   *
   * @returns Буфер, который вызывающий обязан затереть.
   * @throws AccountNotFoundError если ключа нет.
   * @throws VaultCorruptedError если запись повреждена.
   */
  async load(accountId: AccountId): Promise<ISecretBuffer> {
    const stored = await this.#storage.get<string>(
      STORAGE_NAMESPACE.Vault,
      ImportedKeyStore.#keyOf(accountId),
    )

    if (stored === null) {
      throw new AccountNotFoundError(accountId)
    }

    let bytes: Uint8Array

    try {
      bytes = hexToBytes(stored)
    } catch (error) {
      throw new VaultCorruptedError('the private key of the account is corrupted', { cause: error })
    }

    /* Проверка диапазона выполняется и при чтении: запись могла быть
       сделана более старой версией приложения без такой проверки,
       а ключ вне 1..n-1 не задаёт точку на кривой. */
    assertValidPrivateKey(bytes)

    return SecretBuffer.own(bytes)
  }

  /** Есть ли сохранённый ключ для аккаунта. */
  async has(accountId: AccountId): Promise<boolean> {
    return await this.#storage.has(STORAGE_NAMESPACE.Vault, ImportedKeyStore.#keyOf(accountId))
  }

  /**
   * Удаляет ключ.
   *
   * НЕОБРАТИМО: восстановить его из seed-фразы невозможно.
   */
  async remove(accountId: AccountId): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Vault, ImportedKeyStore.#keyOf(accountId))
  }

  static #keyOf(accountId: AccountId): StorageKey {
    return toStorageKey(`${KEY_PREFIX}${accountId}`)
  }
}
