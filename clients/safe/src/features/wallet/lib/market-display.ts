/**
 * Display of market figures.
 *
 * This is not `formatFiat`. That hides sub-cent amounts behind
 * "< $0.01" because a portfolio estimate of that order is
 * indistinguishable from zero for a send decision. A coin price is
 * different: SHIB at $0.00000487 must be a price, not "less than a
 * cent", or the table lies.
 */

const usdInteger = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Price of one coin. `null` is an em dash, not zero. */
export function formatMarketPrice(value: number | null): string {
  if (value === null) {
    return '—'
  }

  const digits = fractionDigitsForPrice(Math.abs(value))

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Volume and market cap without cents: a cent is meaningless at that scale. */
export function formatMarketUsd(value: number | null): string {
  if (value === null) {
    return '—'
  }

  return usdInteger.format(value)
}

/**
 * Percent change for the table.
 *
 * One decimal, matching the source on screen. The sign is not in the
 * string: a triangle next to it carries direction, and a plus beside
 * it would read as a double claim.
 */
export function formatMarketChange(percent: number | null): string {
  if (percent === null) {
    return '—'
  }

  return `${Math.abs(percent).toFixed(1)}%`
}

/** Growth after rounding to the displayed digit. */
export function isMarketChangeUp(percent: number): boolean {
  return Number(percent.toFixed(1)) >= 0
}

function fractionDigitsForPrice(value: number): number {
  if (value >= 1) {
    return 2
  }

  if (value >= 0.01) {
    return 4
  }

  if (value >= 0.0001) {
    return 6
  }

  return 8
}
