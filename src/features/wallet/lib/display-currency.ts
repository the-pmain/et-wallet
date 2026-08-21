/**
 * Валюта показа суммы.
 *
 * Каноническая величина на сервере — доллары. Переключение только
 * меняет, в каких единицах число рисуется.
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

/** Курсы к доллару: сколько единиц валюты за один USD. */
export interface IFiatRates {
  readonly USD: 1
  readonly EUR: number
  readonly GBP: number
}

export const USD_ONLY_RATES: IFiatRates = { USD: 1, EUR: 1, GBP: 1 }

/** Разбирает денежную строку справочника. Пустое и нечисло — `null`. */
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

/** Переводит доллары в выбранную валюту. */
export function convertFromUsd(
  amountUsd: number,
  currency: DisplayCurrency,
  rates: IFiatRates,
): number {
  return amountUsd * rates[currency]
}

/** Денежная величина в выбранной валюте. `null` — прочерк. */
export function formatDisplayFiat(
  amountUsd: number | null,
  currency: DisplayCurrency,
  rates: IFiatRates,
): string {
  if (amountUsd === null) {
    return '—'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(convertFromUsd(amountUsd, currency, rates))
}
