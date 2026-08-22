import { readSendingAmount } from '../sendings/amount.ts'

import type { IAssetToken, IUserAssets } from './assets.ts'
import { sanitizeAssets } from './assets.ts'

const ETHEREUM_CHAIN_ID = '1'

/**
 * Позиция в `tokens` по тикеру.
 *
 * Один тикер бывает в нескольких сетях. Для списания берём Ethereum,
 * затем первую найденную — иначе списывать не с чего.
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
 * Человеческую сумму перевода в минимальные единицы токена.
 *
 * Счёт на строках, без `number`: иначе 0.1 на 18 знаках поедет.
 * Дробь длиннее `decimals` — отказ, не округление.
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

/** Списывает `debit` с выбранной позиции и обновляет `updatedAt`. */
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
