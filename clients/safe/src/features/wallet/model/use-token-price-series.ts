import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  appMarketCatalog,
  coinbaseProductForCoinId,
  fetchCoinbaseCandlePoints,
  mergeLivePrice,
  pointsFromSparkline,
  slicePointsForRange,
  type ChartRange,
  type IPricePoint,
  type IToken,
} from '@/core'

/** How often to re-read candles while the panel is open. */
const LIVE_POLL_MS = 30_000

export type PriceSeriesStatus = 'idle' | 'loading' | 'ready' | 'empty'

export interface ITokenPriceSeries {
  readonly points: readonly IPricePoint[]
  readonly status: PriceSeriesStatus
  readonly isLive: boolean
}

/**
 * Price series of the expanded asset.
 *
 * The request runs only while the panel is open. A closed row does
 * not hit Coinbase: the quota is theirs, and the chart is not visible.
 *
 * Catalog first. The sparkline already lives in the market snapshot,
 * so the line appears immediately. Candles, if the pair is known,
 * replace the series when they arrive. No catalog coin means no
 * request: guessing a pair from a ticker is unsafe — USDC and USD₮
 * look the same.
 */
export function useTokenPriceSeries(
  token: IToken,
  range: ChartRange,
  livePrice: number | null,
): ITokenPriceSeries {
  const catalog = useSyncExternalStore(
    (onStoreChange) => appMarketCatalog.subscribe(onStoreChange),
    () => appMarketCatalog.getSnapshot(),
  )
  const [candles, setCandles] = useState<readonly IPricePoint[]>([])
  const [isFetching, setFetching] = useState(false)

  const coin =
    catalog.status === 'ready'
      ? appMarketCatalog.coinForAsset({
          chainId: token.chainId,
          address: token.address,
          symbol: token.symbol,
        })
      : null
  const coinId = coin?.id ?? null
  const product = coinId === null ? null : coinbaseProductForCoinId(coinId)

  useEffect(() => {
    if (product === null) {
      setCandles([])
      setFetching(false)

      return
    }

    const controller = new AbortController()

    setFetching(true)

    const load = (): void => {
      void fetchCoinbaseCandlePoints(product, range, { signal: controller.signal }).then(
        (points) => {
          if (controller.signal.aborted) {
            return
          }

          setFetching(false)

          if (points.length >= 2) {
            setCandles(points)
          }
        },
      )
    }

    load()
    const timer = globalThis.setInterval(load, LIVE_POLL_MS)

    return () => {
      controller.abort()
      globalThis.clearInterval(timer)
    }
  }, [product, range])

  const sparkline = coin?.sparkline7d ?? null
  const fromSparkline =
    sparkline === null
      ? []
      : slicePointsForRange(pointsFromSparkline(sparkline), range)
  const base = candles.length >= 2 ? candles : fromSparkline
  const points = livePrice === null ? base : mergeLivePrice(base, livePrice)

  if (points.length >= 2) {
    return { points, status: 'ready', isLive: candles.length >= 2 }
  }

  if (isFetching || catalog.status === 'loading') {
    return { points, status: 'loading', isLive: false }
  }

  return { points, status: 'empty', isLive: false }
}
