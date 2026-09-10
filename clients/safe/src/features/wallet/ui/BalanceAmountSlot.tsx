import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Large amount row: the figure or a spinner in the same cell.
 *
 * Height is locked to the amount type size. `text-4xl` / `sm:text-5xl`
 * at `leading-none` occupy 2.5rem and 3rem. The spinner cell matches
 * that size so the row does not jump when the number replaces the
 * ring — otherwise the buttons under the balance shift.
 *
 * The spinner is a ring in a square, not an arc. Rotation is applied
 * to a symmetric circle inside `size-10` / `sm:size-12`. A Lucide arc
 * spun around a foreign center and looked like a running dot.
 */
const AMOUNT_LINE =
  'flex min-h-10 items-center text-4xl leading-none font-semibold tracking-tight break-all tabular-nums sm:min-h-12 sm:text-5xl'

interface BalanceAmountSlotProps {
  readonly isLoading: boolean
  readonly loadingLabel: string
  readonly className?: string
  readonly children: ReactNode
}

export function BalanceAmountSlot({
  isLoading,
  loadingLabel,
  className,
  children,
}: BalanceAmountSlotProps) {
  return (
    <div className={cn(AMOUNT_LINE, className)}>
      {isLoading ? (
        <>
          <span
            className="flex size-10 shrink-0 items-center justify-center sm:size-12"
            aria-hidden
          >
            <span className="balance-spinner" />
          </span>
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </div>
  )
}
