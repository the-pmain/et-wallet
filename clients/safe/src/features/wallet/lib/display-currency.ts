/**
 * Currency used to display an amount.
 *
 * The canonical server value is dollars. Switching only changes the
 * units the figure is drawn in.
 */
export const DISPLAY_CURRENCY = {
  Usd: 'USD',
  Eur: 'EUR',
  Gbp: 'GBP',
} as const

export type DisplayCurrency = (typeof DISPLAY_CURRENCY)[keyof typeof DISPLAY_CURRENCY]

export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = [
  DISPLAY_CURRENCY.Usd,
  DISPLAY_CURRENCY.Eur,
  DISPLAY_CURRENCY.Gbp,
]

/** Rates against the dollar: how many units of the currency per one USD. */
export interface IFiatRates {
  readonly USD: 1
  readonly EUR: number
  readonly GBP: number
}

export const USD_ONLY_RATES: IFiatRates = { USD: 1, EUR: 1, GBP: 1 }

/** Parse a directory money string. Empty or non-numeric is `null`. */
export function parseDisplayAmount(value: string | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    return null
  }

  const amount = Number(trimmed)

  return Number.isFinite(amount) ? amount : null
}

/** Convert dollars into the selected currency. */
export function convertFromUsd(
  amountUsd: number,
  currency: DisplayCurrency,
  rates: IFiatRates,
): number {
  return amountUsd * rates[currency]
}

/** Money figure in the selected currency. `null` is an em dash. */
export function formatDisplayFiat(
  amountUsd: number | null,
  currency: DisplayCurrency,
  rates: IFiatRates,
): string {
  if (amountUsd === null) {
    return '—'
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (amountUsd > 0 && amountUsd < 0.01) {
    return `< ${formatter.format(convertFromUsd(0.01, currency, rates))}`
  }

  return formatter.format(convertFromUsd(amountUsd, currency, rates))
}
