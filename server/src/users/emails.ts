/**
 * Checks an address against column `email`.
 *
 * Case and edge spaces do not split logins: `James@Mail.com` and
 * `james@mail.com` are one record. Empty matches nothing — login
 * without email is impossible.
 */
export function emailsMatch(stored: string | null | undefined, candidate: string): boolean {
  if (stored === null || stored === undefined) {
    return false
  }

  return normalizeEmail(stored) === normalizeEmail(candidate)
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
