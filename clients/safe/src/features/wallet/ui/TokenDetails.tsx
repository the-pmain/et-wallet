import { Check, Copy, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'

import {
  CHART_RANGE,
  TOKEN_STANDARD,
  safeText,
  type Address,
  type ChartRange,
  type IPortfolioSummary,
  type IToken,
} from '@/core'
import { copyWithAutoClear } from '@/features/security'
import { cn } from '@/shared/lib/utils'
import { Badge, Button } from '@/shared/ui'

import { findQuote } from '../lib/asset-value'
import { networkNameForChainId, tokenExplorerUrl } from '../lib/network-name'
import { formatChangePercent } from '../lib/portfolio-display'
import { formatMarketPrice } from '../lib/market-display'
import { useTokenPriceSeries } from '../model/use-token-price-series'
import { TokenPriceChart } from './TokenPriceChart'

interface TokenDetailsProps {
  readonly detailsId: string
  readonly token: IToken
  readonly portfolio: IPortfolioSummary | null
}

const RANGE_OPTIONS: readonly { readonly value: ChartRange; readonly label: string }[] = [
  { value: CHART_RANGE.Hours24, label: '24H' },
  { value: CHART_RANGE.Days7, label: '7D' },
]

/**
 * Expanded asset panel.
 *
 * This is not a second balance card. Quantity and estimate already
 * sit in the row; repeating them at 18 digits and the same dollar
 * would spend height for nothing. Here: the rate, its movement, and
 * contract identification.
 */
export function TokenDetails({ detailsId, token, portfolio }: TokenDetailsProps) {
  const [range, setRange] = useState<ChartRange>(CHART_RANGE.Hours24)
  const networkName = networkNameForChainId(token.chainId)
  const quote = findQuote(portfolio, token.chainId, token.address)
  const explorer = tokenExplorerUrl(token.chainId, token.address)
  const isNative = token.standard === TOKEN_STANDARD.Native || token.address === null
  const change = quote?.change24hPercent ?? null
  const series = useTokenPriceSeries(token, range, quote?.price ?? null)
  const seriesUp =
    series.points.length >= 2
      ? (series.points[series.points.length - 1]?.price ?? 0) >= (series.points[0]?.price ?? 0)
      : change === null || change >= 0
  const symbol = safeText(token.symbol)

  return (
    <div id={detailsId} className="px-3 pb-3 sm:px-5">
      <div className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-xl font-semibold tracking-tight tabular-nums">
              {quote === null ? '—' : formatMarketPrice(quote.price)}
            </p>
            {change === null ? null : (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
                  change >= 0 ? 'text-risk-low' : 'text-risk-high',
                )}
              >
                {change >= 0 ? (
                  <TrendingUp className="size-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden />
                )}
                {formatChangePercent(change)}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {series.isLive ? (
              <span
                className={cn(
                  'flex items-center gap-1.5 text-[11px]',
                  seriesUp ? 'text-risk-low' : 'text-risk-high',
                )}
              >
                <span className="relative flex size-1.5">
                  <span
                    className={cn(
                      'absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none',
                      seriesUp ? 'bg-risk-low' : 'bg-risk-high',
                    )}
                  />
                  <span
                    className={cn(
                      'relative inline-flex size-1.5 rounded-full',
                      seriesUp ? 'bg-risk-low' : 'bg-risk-high',
                    )}
                  />
                </span>
                Live
              </span>
            ) : null}

            <div
              role="group"
              aria-label="Chart range"
              className="grid grid-cols-2 rounded-lg bg-background/60 p-0.5"
            >
              {RANGE_OPTIONS.map((option) => {
                const selected = option.value === range

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setRange(option.value)
                    }}
                    className={cn(
                      'tap-target focus-ring min-h-8 rounded-md px-2.5 text-[11px] font-medium',
                      selected
                        ? 'bg-muted text-foreground shadow-surface'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <TokenPriceChart
          symbol={token.symbol}
          range={range}
          points={series.points}
          status={series.status}
          isLive={series.isLive}
          isUp={seriesUp}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{networkName}</Badge>
          <Badge variant="outline">{isNative ? 'Native currency' : token.standard}</Badge>
        </div>

        {isNative || token.address === null ? (
          <p className="text-xs text-muted-foreground">
            No contract — native currency of the network
          </p>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 font-mono text-[11px] leading-5 break-all">{token.address}</p>
            <CopyAddressButton address={token.address} symbol={token.symbol} />
          </div>
        )}

        {token.address === null || token.isVerified ? null : (
          <p className="text-xs text-muted-foreground">
            {token.isCustom
              ? 'Added by you — not in the built-in list'
              : 'Not in the built-in list'}
          </p>
        )}

        {explorer === null ? null : (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex w-fit items-center gap-1 text-xs text-primary-emphasis underline-offset-4 hover:underline"
          >
            {`Open in ${networkName} explorer`}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      <span className="sr-only">{`${symbol} on ${networkName}`}</span>
    </div>
  )
}

function CopyAddressButton({ address, symbol }: { readonly address: Address; readonly symbol: string }) {
  const [copied, setCopied] = useState(false)
  const label = safeText(symbol)

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-fit shrink-0 px-2"
      aria-label={copied ? `Copied ${label} contract address` : `Copy ${label} contract address`}
      onClick={() => {
        void copyWithAutoClear(address)
          .then(() => {
            setCopied(true)
          })
          .catch(() => {
            /* Clipboard is unavailable on an insecure connection.
               The panel must not unmount because of that. */
          })
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
