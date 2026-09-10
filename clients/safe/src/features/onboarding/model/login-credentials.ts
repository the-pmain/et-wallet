import { normalizeEmail } from '@/core'

/**
 * Sign-in credentials in `localStorage`.
 *
 * After a successful `POST /v1/users` or `POST /v1/users/auth`, this
 * stores `id`, `email`, and `the_p`. The profile is not stored here —
 * the same response already returned it.
 */

export const LOGIN_CREDENTIALS_STORAGE_KEY = 'elmsafe.login-credentials'

export interface ILoginCredentials {
  readonly id: string
  readonly email: string
  readonly theP: string
}

/** Reads the stored sign-in. A corrupted record is treated as missing. */
export function readLoginCredentials(): ILoginCredentials | null {
  try {
    const raw = localStorage.getItem(LOGIN_CREDENTIALS_STORAGE_KEY)

    if (raw === null) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as Record<string, unknown>
    const id = readIdField(record['id'])
    const email = readEmailField(record)
    const theP = record['the_p']

    if (id === null) {
      return null
    }

    if (email === null) {
      return null
    }

    if (typeof theP !== 'string' || theP === '') {
      return null
    }

    return { id, email, theP }
  } catch {
    return null
  }
}

export function writeLoginCredentials(credentials: ILoginCredentials): void {
  try {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        id: credentials.id.trim(),
        email: credentials.email,
        the_p: credentials.theP,
      }),
    )
  } catch {
    /* No quota — sign-in in this tab still succeeded. */
  }
}

export function clearLoginCredentials(): void {
  try {
    localStorage.removeItem(LOGIN_CREDENTIALS_STORAGE_KEY)
  } catch {
    /* No storage — nothing to clear. */
  }
}

export function rememberLogin(id: string, email: string, theP: string): void {
  writeLoginCredentials({ id, email: normalizeEmail(email), theP })
}

/** `id` in storage may be a string or a JSON number from the users table. */
export function readIdField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  return null
}

function readEmailField(record: Record<string, unknown>): string | null {
  const email = record['email']

  if (typeof email === 'string' && email.trim() !== '') {
    return email.trim()
  }

  /* Older records stored the address under `username`. */
  const legacy = record['username']

  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return legacy.trim()
  }

  return null
}
