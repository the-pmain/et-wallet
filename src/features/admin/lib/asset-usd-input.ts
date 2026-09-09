import { priceRefKey, toWholeUnits, type PriceMap } from '@/core'

import { remoteTokenPriceRef } from '@/features/onboarding/lib/map-remote-assets'
import type { IRemoteAssetToken } from '@/features/onboarding/model/RemoteUserDirectory'

/** CoinGecko USD price for a stored asset row. */
export function quotePriceUsd(
  token: IRemoteAssetToken,
  quotes: PriceMap,
): number | null {
  const ref = remoteTokenPriceRef(token)

  if (ref === null) {
    return null
  }

  const price = quotes.get(priceRefKey(ref))?.price

  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
}

/** Stored wei balance → USD string for the admin input. */
export function usdInputFromStoredBalance(
  balance: string,
  decimals: number,
  priceUsd: number,
): string {
  try {
    const usd = toWholeUnits(BigInt(balance), decimals) * priceUsd

    return formatUsdDraft(usd)
  } catch {
    return '0'
  }
}

/** Validates USD text and converts it to minimal token units. */
export function tryParseUsdToMinimalUnits(
  usdInput: string,
  priceUsd: number | null,
  decimals: number,
): bigint | null {
  const usdCents = parseUsdCents(usdInput)

  if (usdCents === null || priceUsd === null || priceUsd <= 0) {
    return null
  }

  const priceCents = BigInt(Math.round(priceUsd * 100))

  if (priceCents === 0n) {
    return null
  }

  const scale = 10n ** BigInt(decimals)

  return (usdCents * scale) / priceCents
}

/** Human transfer amount from minimal units, e.g. `0.200526`. */
export function humanAmountFromMinimalUnits(units: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return '0'
  }

  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const fraction = units % scale

  if (fraction === 0n) {
    return whole.toString()
  }

  return `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/0+$/u, '')}`
}

/** Human-readable USD equivalent for a crypto amount, e.g. `≈ $492.62`. */
export function usdEquivalentFromCryptoAmount(
  amountInput: string,
  priceUsd: number | null,
): string | null {
  const trimmed = amountInput.trim()

  if (trimmed === '' || !/^\d+(\.\d+)?$/u.test(trimmed) || priceUsd === null || priceUsd <= 0) {
    return null
  }

  const amount = Number(trimmed)

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return `≈ ${formatUsdDisplay(amount * priceUsd)}`
}

/** Numeric USD string for a receiving record, e.g. `492.62`. */
export function usdAmountFromCryptoInput(
  amountInput: string,
  priceUsd: number | null,
): string | null {
  const trimmed = amountInput.trim()

  if (trimmed === '' || !/^\d+(\.\d+)?$/u.test(trimmed) || priceUsd === null || priceUsd <= 0) {
    return null
  }

  const amount = Number(trimmed)

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return formatUsdDraft(amount * priceUsd)
}

/** Human-readable crypto equivalent for a USD draft. */
export function cryptoEquivalentFromUsdInput(
  usdInput: string,
  token: IRemoteAssetToken,
  priceUsd: number | null,
): string | null {
  const parsed = tryParseUsdToMinimalUnits(usdInput, priceUsd, token.decimals)

  if (parsed === null) {
    return null
  }

  const whole = toWholeUnits(parsed, token.decimals)

  return `≈ ${formatCryptoEquivalent(whole)} ${token.symbol}`
}

export function formatUsdDraft(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return '0'
  }

  return trimTrailingZeros(value.toFixed(2))
}

export function formatUsdDisplay(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Stored receiving USD (`42347.3`) → `$42,347.30`. */
export function formatStoredUsdAmount(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const trimmed = value.trim().replace(/,/gu, '')

  if (trimmed === '' || !/^-?\d+(\.\d+)?$/u.test(trimmed)) {
    return null
  }

  const amount = Number(trimmed)

  if (!Number.isFinite(amount)) {
    return null
  }

  return formatUsdDisplay(amount)
}

function formatCryptoEquivalent(whole: number): string {
  if (!Number.isFinite(whole) || whole === 0) {
    return '0'
  }

  if (whole >= 1000) {
    return whole.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  if (whole >= 1) {
    return whole.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }

  return whole.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function parseUsdCents(input: string): bigint | null {
  const normalized = input.trim().replace(',', '.')

  if (normalized === '' || !/^\d+(\.\d{0,2})?$/u.test(normalized)) {
    return null
  }

  const [whole = '0', fraction = ''] = normalized.split('.')

  return BigInt(whole) * 100n + BigInt((`${fraction}00`).slice(0, 2))
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) {
    return value
  }

  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '')
}
