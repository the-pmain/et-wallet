import type { SendingStatus } from './status.ts'

export const SENDINGS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type SendingsStoreKind = (typeof SENDINGS_STORE_KIND)[keyof typeof SENDINGS_STORE_KIND]

export interface ISendingRecord {
  readonly id: string
  readonly createdAt: Date
  readonly userId: string | null
  readonly status: SendingStatus | null
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  /** Numeric string only, e.g. `0.01`. No ticker. */
  readonly amount: string | null
}

export interface ICreateSendingInput {
  readonly userId: string
  readonly status?: SendingStatus
  readonly failureMessage?: string | null
  readonly recipientAddress: string
  readonly amount: string
}

export interface IUpdateSendingInput {
  readonly status: SendingStatus
  readonly failureMessage?: string | null
}

export interface ISendingsRepository {
  create(input: ICreateSendingInput): Promise<ISendingRecord>
  update(id: string, patch: IUpdateSendingInput): Promise<ISendingRecord | null>
  findById(id: string): Promise<ISendingRecord | null>
  listByUserId(userId: string, options?: { readonly limit?: number }): Promise<readonly ISendingRecord[]>
}

export interface ISendingsStore {
  readonly sendings: ISendingsRepository
  readonly kind: SendingsStoreKind
  readonly storageWarning: string | null
  close(): Promise<void>
}
