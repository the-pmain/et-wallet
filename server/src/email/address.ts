/**
 * Address check for From/To.
 *
 * This is not a full RFC 5322 check: it rejects empty, spaces, and a
 * domain with no dot. Cloudflare then rejects an address whose domain
 * is not connected to Email Sending.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const EMAIL_MAX = 254

export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim()

  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX) {
    return false
  }

  return EMAIL_SHAPE.test(trimmed)
}

export function emailDomain(value: string): string | null {
  const trimmed = value.trim()

  if (!isEmailAddress(trimmed)) {
    return null
  }

  const at = trimmed.lastIndexOf('@')

  return trimmed.slice(at + 1).toLowerCase()
}

/**
 * Default From mailboxes on the Email Sending domain.
 *
 * Cloudflare accepts any local-part on a connected domain.
 */
export const BASIC_FROM_LOCAL_PARTS = [
  'support',
  'hello',
  'info',
  'contact',
  'team',
  'mail',
  'enquiries',
] as const

export function sendingFromAddresses(mailFrom: string | null): readonly string[] {
  const domain = emailDomain(mailFrom ?? '')

  if (domain === null) {
    return []
  }

  const listed = BASIC_FROM_LOCAL_PARTS.map((part) => `${part}@${domain}`)
  const primary = (mailFrom ?? '').trim().toLowerCase()

  if (primary !== '' && isEmailAddress(primary) && !listed.includes(primary)) {
    return [primary, ...listed]
  }

  if (primary !== '' && listed.includes(primary)) {
    return [primary, ...listed.filter((address) => address !== primary)]
  }

  return listed
}
