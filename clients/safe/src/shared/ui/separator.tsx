import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export interface SeparatorProps extends ComponentProps<'div'> {
  readonly orientation?: 'horizontal' | 'vertical'
}

/**
 * Separator.
 *
 * `role="separator"` with `aria-orientation` instead of `<hr>`: a
 * horizontal rule in HTML means a semantic section break, and here
 * the line is usually decorative and splits list items.
 */
export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
