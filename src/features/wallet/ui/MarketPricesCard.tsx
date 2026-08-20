import { TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CoinGeckoMarketClient, type IMarketCoin } from '@/core'
import { UntrustedText } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@/shared/ui'

import {
  formatMarketChange,
  formatMarketPrice,
  formatMarketUsd,
  isMarketChangeUp,
} from '../lib/market-display'
import { MarketCoinAvatar } from './MarketCoinAvatar'

/** Сколько строк видно до «Show more». */
export const MARKET_PREVIEW_COUNT = 8

export type MarketPricesLoader = (signal: AbortSignal) => Promise<readonly IMarketCoin[]>

interface MarketPricesCardProps {
  /**
   * Подмена запроса. Боевой код её не передаёт: карточка сама ходит
   * к источнику в момент появления. Тест подставляет ответ, чтобы не
   * зависеть от сети и не получить второй тикер ETH на главном экране.
   */
  readonly loadMarkets?: MarketPricesLoader
}

type MarketState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly coins: readonly IMarketCoin[] }
  | { readonly status: 'failed' }

const defaultClient = new CoinGeckoMarketClient()

async function loadDefaultMarkets(signal: AbortSignal): Promise<readonly IMarketCoin[]> {
  return await defaultClient.getMarkets(signal)
}

/**
 * Публичная таблица курсов на главном экране.
 *
 * ЗАПРОС УХОДИТ ПРИ ПОЯВЛЕНИИ КАРТОЧКИ. Это каталог рынка, а не оценка
 * портфеля: в нём нет адресов владельца. Согласие с экрана портфеля
 * сюда не относится.
 *
 * КОЛОНКИ ГРАФИКА НЕТ. Источник умеет отдать ряд за семь дней, но на
 * экране он не рисуется: пользователь просил таблицу чисел, и чужие
 * картинки всё равно запрещены политикой безопасности.
 */
export function MarketPricesCard({ loadMarkets = loadDefaultMarkets }: MarketPricesCardProps = {}) {
  const { t } = useTranslation()
  const [state, setState] = useState<MarketState>({ status: 'loading' })
  const [retryKey, setRetryKey] = useState(0)
  const [visibleCount, setVisibleCount] = useState(MARKET_PREVIEW_COUNT)

  useEffect(() => {
    const controller = new AbortController()

    void loadMarkets(controller.signal)
      .then((coins) => {
        if (controller.signal.aborted) {
          return
        }

        setVisibleCount(MARKET_PREVIEW_COUNT)
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

  const coins = state.status === 'ready' ? state.coins : []
  const visible = coins.slice(0, visibleCount)
  const canShowMore = coins.length > visibleCount

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
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
                  setState({ status: 'loading' })
                  setRetryKey((key) => key + 1)
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
              </thead>
              <tbody>
                {visible.map((coin) => (
                  <MarketRow key={coin.id} coin={coin} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {canShowMore ? (
          <div className="px-4 pb-4 sm:px-6">
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
          </div>
        ) : null}
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-0" aria-hidden>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-6"
        >
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
