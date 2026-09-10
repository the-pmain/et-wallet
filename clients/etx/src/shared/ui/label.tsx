import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Подпись к полю формы.
 *
 * Реализована нативным `label`, а не компонентом Radix: единственное,
 * что даёт обёртка Radix, — связывание с полем, и оно достигается
 * атрибутом `htmlFor` без дополнительной зависимости.
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
