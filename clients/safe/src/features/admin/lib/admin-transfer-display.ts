const MAX_FRACTION_DIGITS = 6

/**
 * List amount: keep the stored string when it already fits, otherwise
 * cut the fraction so an 18-decimal ETH value can be scanned.
 */
export function formatAdminListAmount(amount: string | null): string {
  if (amount === null) {
    return '—'
  }

  const trimmed = amount.trim()

  if (trimmed === '') {
    return '—'
  }

  const match = /^(-?)(\d+)\.(\d+)$/.exec(trimmed)

  if (match === null) {
    return trimmed
  }

  const sign = match[1] ?? ''
  const whole = match[2] ?? trimmed
  const fraction = match[3] ?? ''

  if (fraction.length <= MAX_FRACTION_DIGITS) {
    return trimmed
  }

  const cut = fraction.slice(0, MAX_FRACTION_DIGITS).replace(/0+$/u, '')

  return cut === '' ? `${sign}${whole}` : `${sign}${whole}.${cut}`
}

/** Numeric ids stay whole. UUIDs keep the first block. */
export function formatAdminRecordId(id: string): string {
  if (id.length <= 12 || /^\d+$/.test(id)) {
    return id
  }

  return `${id.slice(0, 8)}…`
}
