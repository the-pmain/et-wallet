import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { appMarketCatalog, type IMarketAssetRef, type PriceMap } from '@/core'

import { remoteTokenPriceRef } from '../lib/map-remote-assets'
import type { IRemoteAssetToken } from './RemoteUserDirectory'

const EMPTY_QUOTES: PriceMap = new Map()

/**
 * Showcase quotes from the market snapshot loaded when the app opened.
 *
 * NO SEPARATE REQUESTS. Each card and each wallet used to hit
 * `simple/price` and `token_price` — free CoinGecko answered 429,
 * and dollars appeared in a burst or not at all.
 */
export function useRemoteAssetQuotes(tokens: readonly IRemoteAssetToken[]): {
  readonly quotes: PriceMap
  readonly isLoading: boolean
} {
  const snapshot = useSyncExternalStore(
    (onStoreChange) => appMarketCatalog.subscribe(onStoreChange),
    () => appMarketCatalog.getSnapshot(),
  )

  useEffect(() => {
    void appMarketCatalog.ensureLoaded()
  }, [])

  const quotes = useMemo(() => {
    if (tokens.length === 0) {
      return EMPTY_QUOTES
    }

    const refs: IMarketAssetRef[] = []
    const seen = new Set<string>()

    for (const token of tokens) {
      const ref = remoteTokenPriceRef(token)

      if (ref === null) {
        continue
      }

      const key = `${ref.chainId.toString()}:${ref.address ?? 'native'}`

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      refs.push({ ...ref, symbol: token.symbol })
    }

    return appMarketCatalog.quotesForAssets(refs)
  }, [tokens, snapshot])

  if (tokens.length === 0) {
    return { quotes: EMPTY_QUOTES, isLoading: false }
  }

  return {
    quotes,
    isLoading: snapshot.status === 'idle' || snapshot.status === 'loading',
  }
}
