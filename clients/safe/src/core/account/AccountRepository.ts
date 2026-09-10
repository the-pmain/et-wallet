import { toAddress } from '@/core/address'
import type { ISecureStorage } from '@/core/encryption'
import { VaultCorruptedError } from '@/core/errors'
import type { KeyringType } from '@/core/keyring'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { AccountId, DerivationPath, KeyringId, Timestamp } from '@/core/types'

import type { IAccountRepository } from './contracts'
import { toAccountId } from './identity'
import type { IAccount } from './types'

const ACTIVE_ID_KEY: StorageKey = toStorageKey('account.activeId')

/**
 * Account representation in storage.
 *
 * Differs from the domain model in the types of branded fields:
 * they are written as ordinary strings. The reverse conversion goes
 * through validating constructors — data from storage is untrusted;
 * it may have been written by another app version or corrupted.
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
 * Account-metadata storage on top of secure storage.
 *
 * ENCRYPTED IN FULL. An address itself is not a secret — it is
 * public on the chain. But the address list ties every account of
 * one user together, and account names ("Payroll", "Exchange")
 * reveal what the funds are for. A locked wallet must tell an
 * observer with disk access neither.
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

    /* Order is restored from the `order` field: enumerating storage
       keys does not preserve it. */
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

    /* The value is untrusted: it may point at a removed account or
       be corrupted. An invalid one is treated as no choice, not as
       a reason to stop startup. */
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
      throw new VaultCorruptedError('the account record has no address or no name')
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
