/**
 * Пользователи в таблице `public.users`.
 *
 * Поля: id, created_at, email, balance, the_p, wallets, assets.
 * Создание пишет строку. Вход читает её по почте и `the_p`.
 * `wallets` — jsonb-список `{ key, value }`: ключ — `0x…`, значение — строка.
 * `assets` — jsonb-витрина портфеля: список токенов, как в криптокошельке.
 */

import type { IUserAssets } from './assets.ts'
import type { IUserWallets } from './wallets.ts'

/** Запись, как её отдаёт хранилище. */
export interface IUserRecord {
  readonly id: string
  readonly createdAt: Date
  readonly email: string | null
  readonly balance: string | null
  readonly theP: string | null
  readonly wallets: IUserWallets
  readonly assets: IUserAssets
}

/** Поля, которые клиент может задать при создании. */
export interface ICreateUserInput {
  readonly email: string | null
  readonly balance: string | null
  readonly theP: string | null
  readonly wallets?: IUserWallets
  readonly assets?: IUserAssets
}

/** Поля входа. Оба обязательны. */
export interface IAuthUserInput {
  readonly email: string
  readonly theP: string
}

/** Добавление адреса в список `wallets`. */
export interface IAddWalletInput {
  readonly email: string
  readonly theP: string
  readonly key: string
  readonly value: string
}

/** Хранилище пользователей. */
export interface IUsersRepository {
  create(input: ICreateUserInput): Promise<IUserRecord>

  /** Ищет запись по первичному ключу. `null` — строки нет. */
  findById(id: string): Promise<IUserRecord | null>

  /**
   * Ищет запись, у которой совпали и `email`, и `the_p`.
   *
   * `null` — совпадения нет. Сообщение наружу одно: неверные данные.
   * Колонка `the_p` из HTTP не уходит.
   */
  findByCredentials(input: IAuthUserInput): Promise<IUserRecord | null>

  /**
   * Пишет адрес в `wallets` записи, найденной по почте и `the_p`.
   *
   * `null` — совпадения нет. Повтор того же ключа заменяет значение.
   */
  addWallet(input: IAddWalletInput): Promise<IUserRecord | null>
}

export const USERS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type UsersStoreKind = (typeof USERS_STORE_KIND)[keyof typeof USERS_STORE_KIND]

/** Освобождает соединения, если они были открыты. */
export interface IUsersStore {
  readonly users: IUsersRepository
  readonly kind: UsersStoreKind
  close(): Promise<void>
}
