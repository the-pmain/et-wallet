/** Amount stored in `public.sendings.amount`: digits, optional fraction. No ticker. */
export const SENDING_AMOUNT_PATTERN = /^\d+(\.\d+)?$/u

export const SENDING_AMOUNT_JSON_PATTERN = String.raw`^\d+(\.\d+)?$`

/** Trimmed numeric amount, or `null` if the value is not just a number. */
export function readSendingAmount(value: string): string | null {
  const amount = value.trim()

  if (amount === '' || !SENDING_AMOUNT_PATTERN.test(amount)) {
    return null
  }

  return amount
}
