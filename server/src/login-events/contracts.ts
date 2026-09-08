/**
 * Successful app logins in `public.login_events`.
 *
 * One row per accepted `POST /v1/users/auth`. Page restore
 * (`GET /v1/users/:id`) and wallet unlock are not logins.
 * `user_id` is a text copy of `public.users.id`.
 */

export const LOGIN_EVENTS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type LoginEventsStoreKind =
  (typeof LOGIN_EVENTS_STORE_KIND)[keyof typeof LOGIN_EVENTS_STORE_KIND]

export interface ILoginEventRecord {
  readonly id: string
  readonly createdAt: Date
  readonly userId: string
}

export interface ICreateLoginEventInput {
  readonly userId: string
}

export interface ILoginEventsRepository {
  create(input: ICreateLoginEventInput): Promise<ILoginEventRecord>
  list(options?: { readonly limit?: number }): Promise<readonly ILoginEventRecord[]>
  listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ILoginEventRecord[]>
}

export interface ILoginEventsStore {
  readonly loginEvents: ILoginEventsRepository
  readonly kind: LoginEventsStoreKind
  readonly storageWarning: string | null
  close(): Promise<void>
}
