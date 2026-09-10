import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Form-field label.
 *
 * Built on a native `label`, not a Radix component: the only thing
 * the Radix wrapper adds is field association, and that is done by
 * `htmlFor` without an extra dependency.
 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
