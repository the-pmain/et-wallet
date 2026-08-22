/** Ticker in JSON and in `asset_symbol`, e.g. `ETH`. */
export const SENDING_SYMBOL_JSON_PATTERN = '^[A-Za-z0-9]{1,16}$'

/**
 * Читает тикер актива. Пустая строка и посторонние знаки — отказ.
 * Регистр приводится к верхнему: `eth` и `ETH` — одна колонка.
 */
export function readSendingSymbol(value: string): string | null {
  const trimmed = value.trim()

  if (!/^[A-Za-z0-9]{1,16}$/u.test(trimmed)) {
    return null
  }

  return trimmed.toUpperCase()
}
