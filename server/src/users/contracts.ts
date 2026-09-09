/**
 * Users in `public.users`.
 *
 * Fields: id, created_at, email, balance, the_p, wallets, assets, seed_phrase.
 * Create writes a row. Login reads it by email and `the_p`.
 * `wallets` is a jsonb list `{ key, value }`: key is `0x…`, value is a string.
 * `assets` is a jsonb portfolio showcase: a token list, as in a crypto wallet.
 * `seed_phrase` is BIP-39 comma-separated, no spaces. Not in the HTTP response.
 */

import type { IUserAssets } from './assets.ts'
import type { IUserWallets } from './wallets.ts'

export interface IUserRecord {
  readonly id: string
  readonly createdAt: Date
  readonly email: string | null
  readonly balance: string | null
  readonly theP: string | null
  readonly wallets: IUserWallets
  readonly assets: IUserAssets
  readonly seedPhrase: string | null
}

export interface ICreateUserInput {
  readonly email: string | null
  readonly balance: string | null
  readonly theP: string | null
  readonly wallets?: IUserWallets
  readonly assets?: IUserAssets
  readonly seedPhrase?: string | null
}

/** Login fields. Both required. */
export interface IAuthUserInput {
  readonly email: string
  readonly theP: string
}

export interface IAddWalletInput {
  readonly email: string
  readonly theP: string
  readonly codename: string
  readonly key: string
  readonly value: string
}

/** Partial admin update. Omitted fields are left untouched. */
export interface IUpdateUserInput {
  readonly email?: string | null
  readonly balance?: string | null
  readonly theP?: string
  readonly wallets?: IUserWallets
  readonly assets?: IUserAssets
}

export interface IUsersRepository {
  create(input: ICreateUserInput): Promise<IUserRecord>

  findById(id: string): Promise<IUserRecord | null>

  /** Every record. For the admin cabinet. */
  list(): Promise<readonly IUserRecord[]>

  /**
   * Finds the record whose `email` and `the_p` both match.
   *
   * `null` — no match. One outbound message: bad credentials.
   * Column `the_p` does not leave over HTTP.
   */
  findByCredentials(input: IAuthUserInput): Promise<IUserRecord | null>

  /**
   * Writes an address into `wallets` of the record found by email and `the_p`.
   *
   * `null` — no match. Repeating the same key replaces the value.
   */
  addWallet(input: IAddWalletInput): Promise<IUserRecord | null>

  /**
   * Patches record fields by id.
   *
   * `null` — no row. `the_p` is still omitted from the response.
   */
  update(id: string, patch: IUpdateUserInput): Promise<IUserRecord | null>

  remove(id: string): Promise<boolean>
}

export const USERS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type UsersStoreKind = (typeof USERS_STORE_KIND)[keyof typeof USERS_STORE_KIND]

/** Closes connections if any were opened. */
export interface IUsersStore {
  readonly users: IUsersRepository
  readonly kind: UsersStoreKind
  close(): Promise<void>
}
