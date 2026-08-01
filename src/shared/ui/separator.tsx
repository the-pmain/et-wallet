import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export interface SeparatorProps extends ComponentProps<'div'> {
  readonly orientation?: 'horizontal' | 'vertical'
}

/**
 * Разделитель.
 *
 * `role="separator"` с `aria-orientation` вместо `<hr>`: горизонтальная
 * линейка в HTML означает смысловой раздел содержания, а здесь линия
 * чаще всего декоративная и разделяет элементы списка.
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
