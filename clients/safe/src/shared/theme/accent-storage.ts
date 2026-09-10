import { DEFAULT_ACCENT_HEX, normalizeAccentHex } from './accent'
import { parseHexColor } from './oklch'

/**
 * Appearance accent in `localStorage`.
 *
 * The look must apply before the encrypted wallet store opens —
 * welcome and unlock already use the brand tokens. IndexedDB is
 * locked at that point, so the hex lives here. It is a colour, not
 * a secret.
 */
export const ACCENT_COLOR_STORAGE_KEY = 'elmsafe.accent-color'

export function readAccentColor(): string {
  try {
    const raw = localStorage.getItem(ACCENT_COLOR_STORAGE_KEY)
    if (raw === null) {
      return DEFAULT_ACCENT_HEX
    }

    return parseHexColor(raw) ?? DEFAULT_ACCENT_HEX
  } catch {
    return DEFAULT_ACCENT_HEX
  }
}

export function writeAccentColor(hex: string): string {
  const normalized = normalizeAccentHex(hex)

  try {
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, normalized)
  } catch {
    /* Quota or a disabled store must not block the live theme. */
  }

  return normalized
}
