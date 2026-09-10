/**
 * Admin cabinet PIN in `localStorage`.
 *
 * After the server accepts it, the presented value is stored here.
 * The next visit to `/admin` does not ask again: the server still
 * checks the header on every request.
 */

export const ADMIN_PIN_STORAGE_KEY = 'elmsafe.admin-pin'

/** Reads the stored PIN. A corrupted record is treated as missing. */
export function readAdminPin(): string | null {
  try {
    const raw = localStorage.getItem(ADMIN_PIN_STORAGE_KEY)

    if (raw === null) {
      return null
    }

    const trimmed = raw.trim()

    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}

export function writeAdminPin(pin: string): void {
  try {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, pin)
  } catch {
    /* No quota — this tab's session is still open. */
  }
}

export function clearAdminPin(): void {
  try {
    localStorage.removeItem(ADMIN_PIN_STORAGE_KEY)
  } catch {
    /* No storage — nothing to clear. */
  }
}
