/**
 * Проверка адреса для поля From/To.
 *
 * Это не полная проверка RFC 5322: она отвергает пустое значение,
 * пробелы и отсутствие точки в домене. Дальше Cloudflare сам
 * отвергнет адрес, с которого домен не подключён к Email Sending.
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

/** Домен адреса, в нижнем регистре. */
export function emailDomain(value: string): string | null {
  const trimmed = value.trim()

  if (!isEmailAddress(trimmed)) {
    return null
  }

  const at = trimmed.lastIndexOf('@')

  return trimmed.slice(at + 1).toLowerCase()
}

/**
 * Базовые ящики «От кого» на домене Email Sending.
 *
 * Cloudflare принимает любой local-part на подключённом домене.
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
