import { useId, useMemo, useState } from 'react'

import { safeText, type ChartRange, type IPricePoint } from '@/core'
import { cn } from '@/shared/lib/utils'
import { Skeleton } from '@/shared/ui'

import { formatMarketPrice } from '../lib/market-display'
import type { PriceSeriesStatus } from '../model/use-token-price-series'

const VIEW_WIDTH = 320
const VIEW_HEIGHT = 120
const PAD_X = 10
const PAD_Y = 8

interface TokenPriceChartProps {
  readonly symbol: string
  readonly range: ChartRange
  readonly points: readonly IPricePoint[]
  readonly status: PriceSeriesStatus
  readonly isLive: boolean
  readonly isUp: boolean
}

/**
 * Price line of the expanded asset.
 *
 * Own SVG, not a library. The portfolio ring is already built that
 * way: a third-party chart package weighs more than one line is worth.
 *
 * Axes are required. A line without price and time is decoration —
 * you cannot tell minus ten cents from minus ten percent. Labels sit
 * outside the SVG so they do not shrink with the viewBox.
 */
export function TokenPriceChart({
  symbol,
  range,
  points,
  status,
  isLive,
  isUp,
}: TokenPriceChartProps) {
  const rawId = useId().replaceAll(':', '')
  const gradientId = `token-chart-${rawId}`
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const layout = useMemo(() => projectSeries(points), [points])
  const label = safeText(symbol)
  const windowLabel = range === '24h' ? 'last 24 hours' : 'last 7 days'

  if (status === 'loading' && points.length < 2) {
    return (
      <div className="flex h-32 items-end" aria-busy>
        <Skeleton className="h-28 w-full rounded-lg" />
        <span className="sr-only">Loading {label} price history</span>
      </div>
    )
  }

  if (status === 'empty' || layout === null) {
    return (
      <p className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground">
        Price history is not available for this asset.
      </p>
    )
  }

  const active = activeIndex === null ? null : (layout.dots[activeIndex] ?? null)
  const description = `${label} price, ${windowLabel}. ${isUp ? 'Up' : 'Down'} over the selected range.`

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-2 gap-y-1">
      <div className="flex flex-col justify-between py-0.5 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
        <span>{formatMarketPrice(layout.max)}</span>
        <span>{formatMarketPrice((layout.max + layout.min) / 2)}</span>
        <span>{formatMarketPrice(layout.min)}</span>
      </div>

      <div className="relative min-w-0">
        <svg
          viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
          preserveAspectRatio="none"
          className={cn('h-32 w-full', isUp ? 'text-risk-low' : 'text-risk-high')}
          role="img"
          aria-label={description}
          onPointerLeave={() => {
            setActiveIndex(null)
          }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const ratio = (event.clientX - bounds.left) / Math.max(bounds.width, 1)
            const index = Math.round(ratio * (layout.dots.length - 1))

            setActiveIndex(Math.min(Math.max(index, 0), layout.dots.length - 1))
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {layout.gridY.map((y) => (
            <line
              key={y}
              x1={PAD_X}
              x2={VIEW_WIDTH - PAD_X}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.12"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={layout.area} fill={`url(#${gradientId})`} />
          <path
            d={layout.line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {active === null ? null : (
            <>
              <line
                x1={active.x}
                x2={active.x}
                y1={PAD_Y}
                y2={VIEW_HEIGHT - PAD_Y}
                stroke="currentColor"
                strokeOpacity="0.45"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={active.x}
                y1={active.y}
                x2={active.x}
                y2={active.y}
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          <line
            x1={layout.last.x}
            y1={layout.last.y}
            x2={layout.last.x}
            y2={layout.last.y}
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={isLive ? 'animate-pulse motion-reduce:animate-none' : undefined}
          />
        </svg>

        {active === null ? null : (
          <p
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-md border border-border/70 bg-popover px-2 py-1 text-[11px] whitespace-nowrap tabular-nums shadow-surface"
            style={{
              left: `${((active.x - PAD_X) / (VIEW_WIDTH - PAD_X * 2)) * 100}%`,
              top: `${(active.y / VIEW_HEIGHT) * 100}%`,
            }}
          >
            {formatMarketPrice(active.price)}
            <span className="ml-1.5 text-muted-foreground">{formatChartTime(active.at, range)}</span>
          </p>
        )}
      </div>

      <span />

      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{formatChartTime(layout.first.at, range)}</span>
        <span>{formatChartTime(layout.last.at, range)}</span>
      </div>
    </div>
  )
}

function formatChartTime(at: number, range: ChartRange): string {
  return new Date(at).toLocaleString(
    'en-US',
    range === '24h'
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' },
  )
}

interface IProjectedDot {
  readonly x: number
  readonly y: number
  readonly at: number
  readonly price: number
}

interface IProjectedSeries {
  readonly line: string
  readonly area: string
  readonly dots: readonly IProjectedDot[]
  readonly first: IProjectedDot
  readonly last: IProjectedDot
  readonly min: number
  readonly max: number
  readonly gridY: readonly number[]
}

function projectSeries(points: readonly IPricePoint[]): IProjectedSeries | null {
  if (points.length < 2) {
    return null
  }

  let min = points[0]?.price ?? 0
  let max = min

  for (const point of points) {
    if (point.price < min) {
      min = point.price
    }

    if (point.price > max) {
      max = point.price
    }
  }

  const span = max - min
  const usableWidth = VIEW_WIDTH - PAD_X * 2
  const usableHeight = VIEW_HEIGHT - PAD_Y * 2
  const lastIndex = points.length - 1
  const dots = points.map((point, index) => {
    const x = PAD_X + (index / lastIndex) * usableWidth
    const ratio = span === 0 ? 0.5 : (point.price - min) / span
    const y = PAD_Y + (1 - ratio) * usableHeight

    return { x, y, at: point.at, price: point.price }
  })
  const first = dots[0]
  const last = dots[lastIndex]

  if (first === undefined || last === undefined) {
    return null
  }

  const line = dots
    .map((dot, index) => `${index === 0 ? 'M' : 'L'} ${dot.x.toFixed(2)} ${dot.y.toFixed(2)}`)
    .join(' ')
  const area = `${line} L ${last.x.toFixed(2)} ${String(VIEW_HEIGHT - PAD_Y)} L ${first.x.toFixed(2)} ${String(VIEW_HEIGHT - PAD_Y)} Z`

  return {
    line,
    area,
    dots,
    first,
    last,
    min,
    max,
    gridY: [PAD_Y, PAD_Y + usableHeight / 2, VIEW_HEIGHT - PAD_Y],
  }
}
