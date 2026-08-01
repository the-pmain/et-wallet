import { toAddress } from '@/core/address'
import type { ISecureStorage } from '@/core/encryption'
import { VaultCorruptedError } from '@/core/errors'
import type { KeyringType } from '@/core/keyring'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { AccountId, DerivationPath, KeyringId, Timestamp } from '@/core/types'

import type { IAccountRepository } from './contracts'
import { toAccountId } from './identity'
import type { IAccount } from './types'

/** Ключ, под которым хранится выбор активного аккаунта. */
const ACTIVE_ID_KEY: StorageKey = toStorageKey('account.activeId')

/**
 * Представление аккаунта в хранилище.
 *
 * Отличается от доменной модели типами брендированных полей: они
 * записываются обычными строками. Обратное преобразование выполняется
 * через валидирующие конструкторы — данные из хранилища недоверенные,
 * они могли быть записаны другой версией приложения либо повреждены.
 */
interface IAccountRecord {
  readonly id: string
  readonly address: string
  readonly name: string
  readonly source: string
  readonly keyringId: string
  readonly derivationPath: string | null
  readonly addressIndex: number | null
  readonly order: number
  readonly hidden: boolean
  readonly createdAt: number
}

/**
 * Хранение метаданных аккаунтов поверх защищённого хранилища.
 *
 * ШИФРУЕТСЯ ЦЕЛИКОМ. Адрес сам по себе не секрет — он публичен
 * в блокчейне. Но список адресов связывает все аккаунты одного
 * пользователя между собой, а имена аккаунтов («Зарплата», «Биржа»)
 * раскрывают назначение средств. Заблокированный кошелёк не должен
 * сообщать наблюдателю с доступом к диску ни того, ни другого.
 */
export class AccountRepository implements IAccountRepository {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  async findAll(): Promise<readonly IAccount[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Accounts)
    const accounts: IAccount[] = []

    for (const key of keys) {
      if (key === ACTIVE_ID_KEY) {
        continue
      }

      const record = await this.#storage.get<IAccountRecord>(STORAGE_NAMESPACE.Accounts, key)

      if (record !== null) {
        accounts.push(AccountRepository.#fromRecord(record))
      }
    }

    /* Порядок восстанавливается по полю `order`: перечисление ключей
       хранилища его не сохраняет. */
    return accounts.sort((left, right) => left.order - right.order)
  }

  async save(account: IAccount): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.Accounts,
      toStorageKey(account.id),
      AccountRepository.#toRecord(account),
    )
  }

  async saveAll(accounts: readonly IAccount[]): Promise<void> {
    for (const account of accounts) {
      await this.save(account)
    }
  }

  async delete(id: AccountId): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Accounts, toStorageKey(id))
  }

  async getActiveId(): Promise<AccountId | null> {
    const stored = await this.#storage.get<string>(STORAGE_NAMESPACE.Settings, ACTIVE_ID_KEY)

    if (stored === null) {
      return null
    }

    /* Значение недоверенное: оно могло указывать на удалённый аккаунт
       либо быть повреждено. Некорректное трактуется как отсутствие
       выбора, а не как повод остановить запуск. */
    try {
      return toAccountId(stored)
    } catch {
      return null
    }
  }

  async setActiveId(id: AccountId): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, ACTIVE_ID_KEY, id)
  }

  static #toRecord(account: IAccount): IAccountRecord {
    return {
      id: account.id,
      address: account.address,
      name: account.name,
      source: account.source,
      keyringId: account.keyringId,
      derivationPath: account.derivationPath,
      addressIndex: account.addressIndex,
      order: account.order,
      hidden: account.hidden,
      createdAt: account.createdAt,
    }
  }

  static #fromRecord(record: IAccountRecord): IAccount {
    if (typeof record.address !== 'string' || typeof record.name !== 'string') {
      throw new VaultCorruptedError('запись аккаунта не содержит адреса либо имени')
    }

    return {
      id: toAccountId(record.id),
      address: toAddress(record.address),
      name: record.name,
      source: record.source as KeyringType,
      keyringId: record.keyringId as KeyringId,
      derivationPath: record.derivationPath as DerivationPath | null,
      addressIndex: record.addressIndex,
      order: record.order,
      hidden: record.hidden,
      createdAt: record.createdAt as Timestamp,
    }
  }
}
