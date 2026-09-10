import { cn } from '@/shared/lib/utils'

export interface IDonutSlice {
  readonly id: string

  /** Label for assistive technology. */
  readonly label: string

  /** Share from zero to one. */
  readonly share: number

  readonly color: string
}

export interface DonutChartProps {
  readonly slices: readonly IDonutSlice[]

  /** Value in the center of the ring. */
  readonly caption?: string

  readonly captionHint?: string

  readonly className?: string
}

interface IArc {
  readonly id: string
  readonly color: string
  readonly length: number
  readonly offset: number
}

const RADIUS = 42

const STROKE_WIDTH = 14

const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Shares below this are not drawn: a fraction of a pixel is invisible. */
const MIN_VISIBLE_SHARE = 0.005

/**
 * Ring chart of shares.
 *
 * WHY A CUSTOM SVG, NOT A CHART LIBRARY. Ready-made libraries weigh
 * hundreds of kilobytes, and the wallet bundle has already grown to
 * the point where sign-in screens pull in the whole network layer.
 * A ring of arcs is a circle with a dashed stroke and a dozen and a
 * half lines of arithmetic.
 *
 * THE CHART IS NOT THE ONLY WAY TO LEARN THE SHARES. It is marked
 * `role="img"` with a text description, and a list with numbers
 * always sits beside it: color as the only cue is unavailable to
 * people with impaired color vision, and the difference between
 * 18% and 22% on a ring is invisible to everyone.
 */
export function DonutChart({ slices, caption, captionHint, className }: DonutChartProps) {
  const visible = slices.filter((slice) => slice.share >= MIN_VISIBLE_SHARE)

  const description = visible
    .map((slice) => `${slice.label} ${(slice.share * 100).toFixed(1)} percent`)
    .join(', ')

  /* Offsets are computed up front, not accumulated during markup:
     a variable mutated inside render gives a different result on a
     second pass — React is allowed to run it twice. */
  const arcs = toArcs(visible)

  return (
    <div className={cn('relative aspect-square w-full max-w-56', className)}>
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        role="img"
        aria-label={description}
      >
        {/* Background ring: without it a one-asset portfolio would
            look like a missing chart. */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-muted"
        />

        {arcs.map((arc) => (
          <circle
            key={arc.id}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>

      {caption === undefined ? null : (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
          <span className="text-lg font-semibold tabular-nums">{caption}</span>
          {captionHint === undefined ? null : (
            <span className="text-xs text-muted-foreground">{captionHint}</span>
          )}
        </div>
      )}
    </div>
  )
}

function toArcs(slices: readonly IDonutSlice[]): readonly IArc[] {
  const arcs: IArc[] = []

  let offset = 0

  for (const slice of slices) {
    const length = slice.share * CIRCUMFERENCE

    arcs.push({ id: slice.id, color: slice.color, length, offset })
    offset += length
  }

  return arcs
}
