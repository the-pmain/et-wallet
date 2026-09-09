import { timingSafeEqual } from 'node:crypto'

export const ADMIN_ROLE = {
  Admin: 'admin',
  Super: 'super',
} as const

export type AdminRole = (typeof ADMIN_ROLE)[keyof typeof ADMIN_ROLE]

/**
 * Cabinet PIN (`/admin`).
 *
 * `ADMIN_PIN` — read. `SUPER_ADMIN_PIN` — full write.
 * No values in source: check against the environment only.
 */
export function resolveAdminRole(value: string): AdminRole | null {
  const presented = value.trim()

  if (presented === '') {
    return null
  }

  const superPin = readEnvPin('SUPER_ADMIN_PIN')
  const adminPin = readEnvPin('ADMIN_PIN')
  const isSuper = superPin !== null && constantTimeEquals(superPin, presented)
  const isAdmin = adminPin !== null && constantTimeEquals(adminPin, presented)

  if (isSuper) {
    return ADMIN_ROLE.Super
  }

  if (isAdmin) {
    return ADMIN_ROLE.Admin
  }

  return null
}

/** Any accepted cabinet role. */
export function pinMatches(value: string): boolean {
  return resolveAdminRole(value) !== null
}

function readEnvPin(name: string): string | null {
  const raw = process.env[name]

  if (raw === undefined || raw.trim() === '') {
    return null
  }

  return raw.trim()
}

function constantTimeEquals(expectedUtf8: string, value: string): boolean {
  const expected = Buffer.from(expectedUtf8, 'utf8')
  const given = Buffer.from(value, 'utf8')

  if (expected.length !== given.length) {
    timingSafeEqual(expected, expected)

    return false
  }

  return timingSafeEqual(expected, given)
}
