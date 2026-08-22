/**
 * Журнал писем менеджера.
 *
 * Отправка через Cloudflare не даёт inbox API: храним отправленные
 * и входящие у себя (память или `public.emails` в Supabase).
 */

export const EMAILS_STORE_KIND = {
  Memory: 'memory',
  Supabase: 'supabase',
} as const

export type EmailsStoreKind = (typeof EMAILS_STORE_KIND)[keyof typeof EMAILS_STORE_KIND]

export const EMAIL_DIRECTION = {
  Sent: 'sent',
  Received: 'received',
} as const

export type EmailDirection = (typeof EMAIL_DIRECTION)[keyof typeof EMAIL_DIRECTION]

export interface IEmailRecord {
  readonly id: string
  readonly createdAt: Date
  readonly direction: EmailDirection
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html: string | null
  readonly text: string | null
  readonly status: string
  readonly providerResult: unknown | null
  readonly externalId: string | null
}

export interface ICreateEmailInput {
  readonly direction: EmailDirection
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html?: string | null
  readonly text?: string | null
  readonly status: string
  readonly providerResult?: unknown | null
  readonly externalId?: string | null
}

export interface IEmailsRepository {
  create(input: ICreateEmailInput): Promise<IEmailRecord>
  list(options?: { readonly limit?: number }): Promise<readonly IEmailRecord[]>
  findById(id: string): Promise<IEmailRecord | null>
  findByExternalId(externalId: string): Promise<IEmailRecord | null>
}

export interface IEmailsStore {
  readonly emails: IEmailsRepository
  readonly kind: EmailsStoreKind
  /** Set when Supabase is configured but `public.emails` is missing. */
  readonly storageWarning: string | null
  close(): Promise<void>
}
