/**
 * Convert a user-entered amount into smallest units.
 *
 * Parsing is string-based, no floating point. `Number('0.1') * 1e18`
 * is 100000000000000001 — one unit more than asked. For money that
 * error is unacceptable: the user would confirm one amount and sign
 * another.
 *
 * A fraction longer than the token decimals is rejected, not rounded:
 * silently dropping digits would send an amount different from what
 * was typed.
 *
 * @throws Error with a clear reason on an invalid record.
 */
export function parseAmount(
  input: string,
  decimals: number,
  options: { readonly allowZero?: boolean } = {},
): bigint {
  const value = input.trim().replace(',', '.')

  if (value === '') {
    throw new Error('Enter an amount')
  }

  if (!/^\d*\.?\d*$/u.test(value)) {
    throw new Error('The amount is written in digits; use a dot or a comma as the separator')
  }

  const [whole = '', fraction = ''] = value.split('.')

  if (fraction.length > decimals) {
    throw new Error(`Too many decimal places: at most ${String(decimals)} allowed`)
  }

  const normalized = `${whole === '' ? '0' : whole}${fraction.padEnd(decimals, '0')}`
  const parsed = BigInt(normalized)

  if (parsed < 0n) {
    throw new Error('The amount cannot be negative')
  }

  if (parsed === 0n && options.allowZero !== true) {
    throw new Error('The amount must be greater than zero')
  }

  return parsed
}
