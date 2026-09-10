import type { IPortfolioPosition } from '@/core'

/**
 * Display of money figures and shares.
 *
 * Every figure here is an estimate. They come from balance × a
 * third-party rate and are only for order of magnitude. None of them
 * enter a transaction: signed amounts are integers in smallest units.
 */

/** Fractional digits in a money figure. */
const FIAT_FRACTION_DIGITS = 2

/**
 * Threshold below which an amount is shown as "less than a cent".
 *
 * Rounding to zero would show "$0.00" on a position that is worth
 * something: the user would read that as "worthless".
 */
const MIN_DISPLAYED_FIAT = 0.01

/*
  Number locale follows the UI locale. This used to be `ru-RU`, so the
  estimate rendered as "1 234,56 $" on an otherwise English screen:
  comma as the decimal separator, currency after the number. An
  English reader would take that as another figure or a typo.

  Fixed together with showing the estimate on the home screen, where
  the mismatch is the first thing the owner sees. Grouping and the
  sign now follow the document language — `$1,234.56`.
*/
const fiatFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: FIAT_FRACTION_DIGITS,
  maximumFractionDigits: FIAT_FRACTION_DIGITS,
})

/**
 * Money figure.
 *
 * `null` is an em dash, not zero: "value unknown" and "worth zero"
 * are different claims, and the second in place of the first reads
 * as funds gone.
 */
export function formatFiat(value: number | null): string {
  if (value === null) {
    return '—'
  }

  if (value > 0 && value < MIN_DISPLAYED_FIAT) {
    return `< ${fiatFormatter.format(MIN_DISPLAYED_FIAT)}`
  }

  return fiatFormatter.format(value)
}

/**
 * Quote hours and minutes. `null` means the instant is unknown.
 *
 * Quote age is shown because there is no "real time". The rate polls
 * once a minute while the screen is open; a source failure leaves the
 * previous figure. Without a time next to it, twenty seconds and
 * twenty minutes look equally live.
 *
 * Seconds are omitted on purpose: precision that does not exist would
 * read as a promise. Minutes are the digit the rate actually updates
 * in.
 */
export function formatQuoteTime(at: number | null): string | null {
  return at === null ? null : timeFormatter.format(at)
}

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

/** Share as a percent. `null` is an em dash. */
export function formatShare(share: number | null): string {
  return share === null ? '—' : `${(share * 100).toFixed(1)} %`
}

/** Signed percent change. `null` is an em dash. */
export function formatChangePercent(percent: number | null): string {
  if (percent === null) {
    return '—'
  }

  const sign = percent > 0 ? '+' : ''

  return `${sign}${percent.toFixed(2)} %`
}

/**
 * Chart slice colors.
 *
 * Taken from design tokens, not hex literals: otherwise the chart
 * would not follow a theme change and some slices would vanish on
 * a dark background.
 *
 * Eight shades: a person cannot tell more apart on a ring, and extra
 * positions collapse into "other".
 */
const SLICE_COLORS: readonly string[] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
]

/** Slice color by its index. */
export function sliceColor(index: number): string {
  return SLICE_COLORS[index % SLICE_COLORS.length] ?? SLICE_COLORS[0] ?? 'var(--primary)'
}

/** Stable position key: the (chain, address) pair is unique. */
export function positionKey(position: IPortfolioPosition): string {
  const { chainId, address } = position.token

  return `${chainId.toString()}:${address ?? 'native'}`
}
