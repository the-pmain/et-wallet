import { TrendingUp } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { appMarketCatalog, type IMarketCoin } from '@/core'
import { UntrustedText } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, CABINET_SHEET, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@/shared/ui'

import {
  formatMarketChange,
  formatMarketPrice,
  formatMarketUsd,
  isMarketChangeUp,
} from '../lib/market-display'
import { MarketCoinAvatar } from './MarketCoinAvatar'

/** How many rows are visible before "Show more". */
export const MARKET_PREVIEW_COUNT = 8

export type MarketPricesLoader = (signal: AbortSignal) => Promise<readonly IMarketCoin[]>

interface MarketPricesCardProps {
  /**
   * Request override. Production does not pass it: the table reads the
   * market snapshot loaded at app open. Tests inject a response so they
   * do not depend on the shared catalog.
   */
  readonly loadMarkets?: MarketPricesLoader
}

type MarketState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly coins: readonly IMarketCoin[] }
  | { readonly status: 'failed' }

/**
 * Public price table on the home screen.
 *
 * The request fires once at app open. This is a market catalog, not a
 * portfolio valuation: it contains no owner addresses. Portfolio-screen
 * consent does not apply here.
 *
 * No chart column. The source can return a seven-day series, but it is
 * not drawn: the user asked for a table of numbers, and foreign images
 * are forbidden by the security policy.
 */
export function MarketPricesCard({ loadMarkets }: MarketPricesCardProps = {}) {
  const { t } = useTranslation()
  const injected = useInjectedMarkets(loadMarkets)
  const catalog = useSyncExternalStore(
    (onStoreChange) => appMarketCatalog.subscribe(onStoreChange),
    () => appMarketCatalog.getSnapshot(),
  )
  const [visibleCount, setVisibleCount] = useState(MARKET_PREVIEW_COUNT)

  useEffect(() => {
    if (loadMarkets === undefined) {
      void appMarketCatalog.ensureLoaded()
    }
  }, [loadMarkets])

  const state: MarketState =
    loadMarkets !== undefined
      ? injected.state
      : catalog.status === 'failed'
        ? { status: 'failed' }
        : catalog.status === 'ready'
          ? { status: 'ready', coins: catalog.coins }
          : { status: 'loading' }

  const coins = state.status === 'ready' ? state.coins : []
  const visible = coins.slice(0, visibleCount)
  const canShowMore = coins.length > visibleCount

  return (
    <Card className={cn('min-w-0 overflow-hidden', CABINET_SHEET)}>
      <CardHeader className="max-lg:border-b max-lg:border-border max-lg:px-1 max-lg:pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground max-lg:text-sm max-lg:font-semibold max-lg:text-foreground">
          {t('dashboard.prices')}
        </CardTitle>
      </CardHeader>

      <CardContent
        className="flex min-w-0 flex-col gap-2 p-0 sm:p-0"
        aria-busy={state.status === 'loading'}
      >
        {state.status === 'loading' ? <MarketPricesSkeleton /> : null}

        {state.status === 'failed' ? (
          <EmptyState
            icon={TrendingUp}
            title={t('dashboard.pricesFailedTitle')}
            description={t('dashboard.pricesFailed')}
            className="gap-2 py-6"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (loadMarkets !== undefined) {
                    injected.retry()
                    return
                  }

                  void appMarketCatalog.retry()
                }}
              >
                {t('dashboard.pricesRetry')}
              </Button>
            }
          />
        ) : null}

        {state.status === 'ready' && coins.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t('dashboard.pricesEmptyTitle')}
            description={t('dashboard.pricesEmpty')}
            className="gap-2 py-6"
          />
        ) : null}

        {state.status === 'ready' && coins.length > 0 ? (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">{t('dashboard.pricesCaption')}</caption>
              <thead>
                <MarketHead />
              </thead>
              <tbody>
                {visible.map((coin) => (
                  <MarketRow key={coin.id} coin={coin} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex min-h-12 items-center px-4 pb-4 sm:px-6">
          {canShowMore ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() =>
                setVisibleCount((count) => Math.min(count + MARKET_PREVIEW_COUNT, coins.length))
              }
            >
              {t('dashboard.pricesShowMore')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function useInjectedMarkets(loadMarkets: MarketPricesLoader | undefined): {
  readonly state: MarketState
  readonly retry: () => void
} {
  const [state, setState] = useState<MarketState>({ status: 'loading' })
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (loadMarkets === undefined) {
      return
    }

    const controller = new AbortController()

    void loadMarkets(controller.signal)
      .then((coins) => {
        if (controller.signal.aborted) {
          return
        }

        setState({ status: 'ready', coins })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return
        }

        console.error(error)
        setState({ status: 'failed' })
      })

    return () => {
      controller.abort()
    }
  }, [loadMarkets, retryKey])

  return {
    state,
    retry: () => {
      setState({ status: 'loading' })
      setRetryKey((key) => key + 1)
    },
  }
}

function MarketHead() {
  const { t } = useTranslation()

  return (
    <tr className="border-b border-border/70 bg-muted/40 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
      <th scope="col" className="px-3 py-2.5 font-medium sm:pl-6">
        {t('dashboard.pricesRank')}
      </th>
      <th scope="col" className="px-3 py-2.5 font-medium">
        {t('dashboard.pricesCoin')}
      </th>
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {t('dashboard.pricesPrice')}
      </th>
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {t('dashboard.prices1h')}
      </th>
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {t('dashboard.prices24h')}
      </th>
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {t('dashboard.prices7d')}
      </th>
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {t('dashboard.pricesVolume')}
      </th>
      <th scope="col" className="px-3 py-2.5 pr-3 text-right font-medium sm:pr-6">
        {t('dashboard.pricesMarketCap')}
      </th>
    </tr>
  )
}

function MarketRow({ coin }: { readonly coin: IMarketCoin }) {
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td className="px-3 py-3 text-muted-foreground tabular-nums sm:pl-6">{coin.rank}</td>
      <td className="px-3 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <MarketCoinAvatar coinId={coin.id} symbol={coin.symbol} />
          <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
            <UntrustedText value={coin.name} className="truncate font-semibold" />
            <UntrustedText
              value={coin.symbol}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            />
          </span>
        </span>
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
        {formatMarketPrice(coin.priceUsd)}
      </td>
      <ChangeCell percent={coin.change1hPercent} />
      <ChangeCell percent={coin.change24hPercent} />
      <ChangeCell percent={coin.change7dPercent} />
      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
        {formatMarketUsd(coin.volume24hUsd)}
      </td>
      <td className="px-3 py-3 pr-3 text-right whitespace-nowrap tabular-nums sm:pr-6">
        {formatMarketUsd(coin.marketCapUsd)}
      </td>
    </tr>
  )
}

function ChangeCell({ percent }: { readonly percent: number | null }) {
  if (percent === null) {
    return <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">—</td>
  }

  const isUp = isMarketChangeUp(percent)

  return (
    <td
      className={cn(
        'px-3 py-3 text-right whitespace-nowrap tabular-nums',
        isUp ? 'text-risk-low' : 'text-risk-high',
      )}
    >
      <span className="inline-flex items-center justify-end gap-1">
        <span aria-hidden>{isUp ? '▲' : '▼'}</span>
        {formatMarketChange(percent)}
      </span>
    </td>
  )
}

function MarketPricesSkeleton() {
  return (
    <div className="min-w-0 overflow-x-auto" aria-hidden>
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <MarketHead />
        </thead>
        <tbody>
          {Array.from({ length: MARKET_PREVIEW_COUNT }, (_, index) => (
            <tr key={index} className="border-b border-border/60">
              <td className="px-3 py-3 sm:pl-6">
                <Skeleton className="h-4 w-6" />
              </td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-2.5">
                  <Skeleton className="size-7 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                </span>
              </td>
              <td className="px-3 py-3">
                <Skeleton className="ml-auto h-4 w-20" />
              </td>
              <td className="px-3 py-3">
                <Skeleton className="ml-auto h-4 w-12" />
              </td>
              <td className="px-3 py-3">
                <Skeleton className="ml-auto h-4 w-12" />
              </td>
              <td className="px-3 py-3">
                <Skeleton className="ml-auto h-4 w-12" />
              </td>
              <td className="px-3 py-3">
                <Skeleton className="ml-auto h-4 w-16" />
              </td>
              <td className="px-3 py-3 pr-3 sm:pr-6">
                <Skeleton className="ml-auto h-4 w-16" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
