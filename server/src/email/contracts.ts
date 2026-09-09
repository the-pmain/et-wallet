/**
 * Mail sending via Cloudflare Email Sending.
 *
 * Secrets live only on the server. The cabinet client sends addresses
 * and text; the Cloudflare token never reaches the browser.
 */

export interface IEmailMessage {
  readonly to: string
  readonly from: string
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** Delivery result Cloudflare returned without internal fields. */
export interface IEmailSendResult {
  readonly messageId: string | null
  readonly delivered: readonly string[]
  readonly queued: readonly string[]
  readonly permanentBounces: readonly string[]
}

/** Send service. A test supplies its own implementation without a network. */
export interface IEmailService {
  readonly isConfigured: boolean
  send(message: IEmailMessage): Promise<IEmailSendResult>
}
