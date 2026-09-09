import type { SendingStatus } from '../sendings/status.ts'

export const RECEIVINGS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type ReceivingsStoreKind = (typeof RECEIVINGS_STORE_KIND)[keyof typeof RECEIVINGS_STORE_KIND]

export interface IReceivingRecord {
  readonly id: string
  readonly createdAt: Date
  readonly userId: string | null
  readonly status: SendingStatus | null
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  /** Numeric string only, e.g. `0.01`. No ticker. */
  readonly amount: string | null
  /** Ticker only, e.g. `ETH`. Column `asset_symbol`. */
  readonly symbol: string | null
  /** Admin USD draft that produced `amount`. Column `usd_amount`. */
  readonly usdAmount: string | null
}

export interface ICreateReceivingInput {
  readonly userId: string
  readonly status?: SendingStatus
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

export interface IUpdateReceivingInput {
  readonly status: SendingStatus
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount?: string
  readonly symbol?: string
  readonly usdAmount?: string | null
}

export interface IReceivingsRepository {
  create(input: ICreateReceivingInput): Promise<IReceivingRecord>
  update(id: string, patch: IUpdateReceivingInput): Promise<IReceivingRecord | null>
  findById(id: string): Promise<IReceivingRecord | null>
  list(options?: { readonly limit?: number }): Promise<readonly IReceivingRecord[]>
  listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly IReceivingRecord[]>
}

export interface IReceivingsStore {
  readonly receivings: IReceivingsRepository
  readonly kind: ReceivingsStoreKind
  readonly storageWarning: string | null
  close(): Promise<void>
}
