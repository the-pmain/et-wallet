import { readSendingAmount } from '../sendings/amount.ts'

import type { IAssetToken, IUserAssets } from './assets.ts'
import { sanitizeAssets } from './assets.ts'

const ETHEREUM_CHAIN_ID = '1'

/**
 * A `tokens` holding by ticker.
 *
 * One ticker can exist on several networks. For debit we take
 * Ethereum, then the first match — otherwise there is nothing to
 * debit.
 */
export function findTokenBySymbol(
  tokens: readonly IAssetToken[],
  symbol: string,
): IAssetToken | null {
  const needle = symbol.trim().toUpperCase()

  if (needle === '') {
    return null
  }

  const matches = tokens.filter((token) => token.symbol.toUpperCase() === needle)

  return matches.find((token) => token.chainId === ETHEREUM_CHAIN_ID) ?? matches[0] ?? null
}

/**
 * Human transfer amount in the token's smallest units.
 *
 * Arithmetic is on strings, not `number`: otherwise 0.1 at 18
 * decimals drifts. A fraction longer than `decimals` is a refusal,
 * not rounding.
 */
export function toTokenUnits(amount: string, decimals: number): bigint | null {
  const normalized = readSendingAmount(amount)

  if (normalized === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return null
  }

  const [whole = '0', fraction = ''] = normalized.split('.')

  if (fraction.length > decimals) {
    return null
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`)
}

export function subtractTokenBalance(balance: string, debit: bigint): string {
  const current = BigInt(balance)
  const next = current > debit ? current - debit : 0n

  return next.toString()
}

/** Debits `debit` from the chosen holding and updates `updatedAt`. */
export function debitToken(
  assets: IUserAssets,
  token: IAssetToken,
  debit: bigint,
  now: Date = new Date(),
): IUserAssets {
  return sanitizeAssets({
    quoteCurrency: assets.quoteCurrency,
    updatedAt: now.toISOString(),
    tokens: assets.tokens.map((item) =>
      sameToken(item, token)
        ? { ...item, balance: subtractTokenBalance(item.balance, debit) }
        : item,
    ),
  })
}

function sameToken(left: IAssetToken, right: IAssetToken): boolean {
  return (
    left.chainId === right.chainId &&
    left.address === right.address &&
    left.symbol.toUpperCase() === right.symbol.toUpperCase()
  )
}
