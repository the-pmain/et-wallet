import type { IServerConfig } from '../config.ts'
import { emailDomain } from '../email/address.ts'

import { CloudflareEmailsRepository } from './CloudflareEmailsRepository.ts'
import { EMAILS_STORE_KIND, type IEmailsStore } from './contracts.ts'
import { ensureCloudflareInbox, resolveCloudflareZoneId } from './ensureCloudflareInbox.ts'
import { MemoryEmailsRepository } from './MemoryEmailsRepository.ts'

const MISSING_ZONE_WARNING =
  'Cloudflare Email Sending is configured, but the MAIL_FROM domain has no zone. Using in-memory mail until the zone is available.'

/**
 * Mail-manager inbox.
 *
 * Source is Cloudflare (activity log + KV). Supabase is not used for mail.
 */
export async function createEmailsStore(
  config: IServerConfig,
  options: { readonly ensureInbox?: boolean } = {},
): Promise<IEmailsStore> {
  const accountId = config.cloudflareAccountId
  const apiToken = config.cloudflareApiToken
  const domain = emailDomain(config.mailFrom ?? '') ?? 'etwalletx.com'

  if (accountId === null || apiToken === null) {
    return memoryStore(null)
  }

  const zoneId = await resolveCloudflareZoneId({
    accountId,
    apiToken,
    authEmail: config.cloudflareAuthEmail,
    domain,
  })

  if (zoneId === null) {
    console.warn(MISSING_ZONE_WARNING)

    return memoryStore(MISSING_ZONE_WARNING)
  }

  let kvNamespaceId: string | null = null
  let storageWarning: string | null = null

  if (options.ensureInbox !== false) {
    const inbox = await ensureCloudflareInbox({
      accountId,
      apiToken,
      authEmail: config.cloudflareAuthEmail,
      zoneId,
    })

    kvNamespaceId = inbox.kvNamespaceId
    storageWarning = inbox.warning
  }

  return {
    emails: new CloudflareEmailsRepository({
      accountId,
      apiToken,
      authEmail: config.cloudflareAuthEmail,
      zoneId,
      kvNamespaceId,
    }),
    kind: EMAILS_STORE_KIND.Cloudflare,
    storageWarning,
    close: () => Promise.resolve(),
  }
}

function memoryStore(storageWarning: string | null): IEmailsStore {
  return {
    emails: new MemoryEmailsRepository(),
    kind: EMAILS_STORE_KIND.Memory,
    storageWarning,
    close: () => Promise.resolve(),
  }
}
