import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Placeholder while loading.
 *
 * WHY IT IS NOT SHOWN IN PLACE OF NUMERIC VALUES. A placeholder where
 * a balance sits looks like “a number is coming” and pushes the user
 * to wait for it, missing that the data never arrived. Amounts use an
 * explicit text state. A placeholder belongs where missing data
 * decides nothing: lists, headings, chrome.
 *
 * `aria-hidden`: a screen reader has nothing to announce, and the
 * loading state is spoken by nearby text.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
