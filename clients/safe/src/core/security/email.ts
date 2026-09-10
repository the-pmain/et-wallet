/**
 * Email address as a sign-in identifier.
 *
 * In `public.users` it lives in the `email` column.
 * The password is `the_p`. Sign-ins are case-insensitive,
 * so the address is stored lowercased.
 *
 * Validation is deliberately simple: we need an address a person
 * recognises as mail, not a full RFC. Empty values and spaces are
 * rejected.
 */

/** Maximum address length per RFC 5321. */
export const MAX_EMAIL_LENGTH = 254

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/**
 * Normalises an address for storage and comparison.
 *
 * Leading/trailing spaces are stripped, case is lowered: `James@Mail.com`
 * and `james@mail.com` are one sign-in.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value)

  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    return false
  }

  return EMAIL_PATTERN.test(normalized)
}
