/**
 * Пользователи в таблице `public.users`.
 *
 * Поля: id, created_at, username, balance, the_p.
 * `the_p` — текстовая колонка пароля, не проверка входа в кошелёк.
 */

/** Запись, как её отдаёт хранилище. */
export interface IUserRecord {
  readonly id: string
  readonly createdAt: Date
  readonly username: string | null
  readonly balance: string | null
  readonly theP: string | null
}

/** Поля, которые клиент может задать при создании. */
export interface ICreateUserInput {
  readonly username: string | null
  readonly balance: string | null
  readonly theP: string | null
}

/** Хранилище пользователей. */
export interface IUsersRepository {
  create(input: ICreateUserInput): Promise<IUserRecord>
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
