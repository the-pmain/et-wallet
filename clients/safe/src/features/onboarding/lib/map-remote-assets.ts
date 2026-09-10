import {
  TOKEN_STANDARD,
  buildPortfolio,
  toAddress,
  toChainId,
  type IPortfolioSummary,
  type IToken,
  type ITokenAmount,
  type PriceMap,
  type Timestamp,
} from '@/core'

import type { IRemoteAssetToken, IRemoteAssets } from '../model/RemoteUserDirectory'

export interface IMappedRemoteAssets {
  readonly tokens: readonly ITokenAmount[]
  readonly portfolio: IPortfolioSummary
}

/**
 * Maps the `users.assets` showcase into what the asset list renders.
 *
 * QUOTES ARRIVE FROM OUTSIDE. The record has no price: valuation is
 * computed on the client. Without a quote map the list still shows
 * balances, and the dollar column is empty.
 *
 * ROW ORDER IS PRESERVED. The portfolio summary sorts positions by
 * valuation internally — that is its concern. The list shows exactly
 * what the record holds, in the same order.
 *
 * A BROKEN ROW IS SKIPPED, NOT A CRASH OF THE LIST.
 */
export function mapRemoteAssets(
  assets: IRemoteAssets,
  prices: PriceMap = new Map(),
): IMappedRemoteAssets {
  const tokens: ITokenAmount[] = []
  const quotedAt = parseTimestamp(assets.updatedAt)

  for (const entry of assets.tokens) {
    const mapped = mapRemoteToken(entry, quotedAt)

    if (mapped === null) {
      continue
    }

    tokens.push({ token: mapped.token, balance: mapped.balance })
  }

  return {
    tokens,
    portfolio: buildPortfolio(tokens, prices),
  }
}

function mapRemoteToken(
  entry: IRemoteAssetToken,
  quotedAt: Timestamp,
): { readonly token: IToken; readonly balance: bigint } | null {
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

  return { token, balance }
}

export function remoteTokenPriceRef(entry: IRemoteAssetToken): {
  readonly chainId: ReturnType<typeof toChainId>
  readonly address: ReturnType<typeof toAddress> | null
} | null {
  try {
    const chainId = toChainId(entry.chainId)
    const address =
      entry.standard === 'native' || entry.address === null ? null : toAddress(entry.address)

    return { chainId, address }
  } catch {
    return null
  }
}

function parseTimestamp(iso: string): Timestamp {
  const milliseconds = Date.parse(iso)

  return (Number.isFinite(milliseconds) ? milliseconds : 0) as Timestamp
}
