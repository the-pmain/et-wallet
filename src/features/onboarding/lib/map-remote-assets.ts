import {
  TOKEN_STANDARD,
  buildPortfolio,
  priceRefKey,
  toAddress,
  toChainId,
  type IPortfolioSummary,
  type IPriceQuote,
  type IToken,
  type ITokenAmount,
  type Timestamp,
} from '@/core'

import type { IRemoteAssetToken, IRemoteAssets } from '../model/RemoteUserDirectory'

/** Балансы и курсы из витрины `assets`, в форме списка активов. */
export interface IMappedRemoteAssets {
  readonly tokens: readonly ITokenAmount[]
  readonly portfolio: IPortfolioSummary
}

/**
 * Переносит витрину `users.assets` в то, что рисует список активов.
 *
 * ПОРЯДОК СТРОК СОХРАНЯЕТСЯ. Сводка портфеля внутри себя сортирует
 * позиции по оценке — это её дело. Список показывает ровно то, что
 * лежит в записи, в том же порядке: иначе владелец увидел бы другую
 * витрину, чем та, которую сервер хранит.
 *
 * БИТАЯ СТРОКА ПРОПУСКАЕТСЯ, А НЕ РОНЯЕТ СПИСОК. Один неразборчивый
 * адрес или баланс не должен прятать остальные токены.
 */
export function mapRemoteAssets(assets: IRemoteAssets): IMappedRemoteAssets {
  const tokens: ITokenAmount[] = []
  const prices = new Map<string, IPriceQuote>()
  const quotedAt = parseTimestamp(assets.updatedAt)

  for (const entry of assets.tokens) {
    const mapped = mapRemoteToken(entry, quotedAt)

    if (mapped === null) {
      continue
    }

    tokens.push({ token: mapped.token, balance: mapped.balance })

    if (mapped.quote !== null) {
      prices.set(priceRefKey(mapped.token), mapped.quote)
    }
  }

  return {
    tokens,
    portfolio: buildPortfolio(tokens, prices),
  }
}

function mapRemoteToken(
  entry: IRemoteAssetToken,
  quotedAt: Timestamp,
): { readonly token: IToken; readonly balance: bigint; readonly quote: IPriceQuote | null } | null {
  if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 36) {
    return null
  }

  let chainId

  try {
    chainId = toChainId(entry.chainId)
  } catch {
    return null
  }

  let address: IToken['address']

  if (entry.standard === 'native') {
    address = null
  } else if (entry.address === null) {
    return null
  } else {
    try {
      address = toAddress(entry.address)
    } catch {
      return null
    }
  }

  let balance: bigint

  try {
    balance = BigInt(entry.balance)
  } catch {
    return null
  }

  if (balance < 0n) {
    return null
  }

  const token: IToken = {
    chainId,
    address,
    standard: entry.standard === 'native' ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol: entry.symbol,
    name: entry.name,
    decimals: entry.decimals,
    logoUri: null,
    isCustom: false,
    isVerified: entry.isVerified,
    addedAt: quotedAt,
  }

  return { token, balance, quote: readQuote(entry, quotedAt) }
}

function readQuote(entry: IRemoteAssetToken, quotedAt: Timestamp): IPriceQuote | null {
  const price = Number.parseFloat(entry.priceUsd)

  if (!Number.isFinite(price) || price < 0) {
    return null
  }

  const change = Number.parseFloat(entry.change24hPercent)

  return {
    price,
    change24hPercent: Number.isFinite(change) ? change : null,
    updatedAt: quotedAt,
  }
}

function parseTimestamp(iso: string): Timestamp {
  const milliseconds = Date.parse(iso)

  return (Number.isFinite(milliseconds) ? milliseconds : 0) as Timestamp
}
