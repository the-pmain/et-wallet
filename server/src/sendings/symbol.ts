/** Ticker in JSON and in `asset_symbol`, e.g. `ETH`. */
export const SENDING_SYMBOL_JSON_PATTERN = '^[A-Za-z0-9]{1,16}$'

/**
 * Reads an asset ticker. Empty and foreign characters are a refusal.
 * Case is folded to upper: `eth` and `ETH` are one column.
 */
export function readSendingSymbol(value: string): string | null {
  const trimmed = value.trim()

  if (!/^[A-Za-z0-9]{1,16}$/u.test(trimmed)) {
    return null
  }

  return trimmed.toUpperCase()
}
