import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

export interface EmptyStateProps {
  readonly icon: ComponentType<{ className?: string }>
  readonly title: string

  /**
   * Why the list is empty.
   *
   * Required, not optional. An empty list with no explanation is
   * read as “I have nothing” — a dangerous reading when the real
   * reason is that the wallet cannot read this data yet. The
   * difference between “no assets” and “assets are not tracked”
   * decides whether someone runs off looking for missing funds.
   */
  readonly description: ReactNode

  readonly action?: ReactNode

  /* `| undefined` is explicit: under `exactOptionalPropertyTypes` an
     optional property and a property whose value may be `undefined`
     are different types, and the value arrives forwarded from another
     optional field. */
  readonly className?: string | undefined
}

/**
 * Empty list state with a required explanation.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <div className="icon-tile size-12 rounded-2xl">
        <Icon className="size-6" />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {action}
    </div>
  )
}
