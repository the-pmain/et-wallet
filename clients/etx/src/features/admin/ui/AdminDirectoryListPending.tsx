import { Loader2 } from 'lucide-react'

import { Skeleton } from '@/shared/ui'

/**
 * List body while a directory search or page fetch is in flight.
 *
 * The heading and search field stay up so the admin can keep typing.
 */
export function AdminDirectoryListPending({
  label = 'Loading records',
}: {
  readonly label?: string
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </p>
      <Skeleton className="h-[5.75rem] w-full rounded-xl" />
      <Skeleton className="h-[5.75rem] w-full rounded-xl" />
      <Skeleton className="h-[5.75rem] w-full rounded-xl" />
    </div>
  )
}
