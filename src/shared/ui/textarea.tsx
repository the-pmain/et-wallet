import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Многострочное поле ввода.
 *
 * Как и `Input`, по умолчанию отключает проверку орфографии: сюда
 * вводится seed-фраза, и отправка её содержимого во внешнюю службу
 * проверки правописания означала бы потерю кошелька.
 */
export function Textarea({ className, spellCheck = false, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      spellCheck={spellCheck}
      className={cn(
        'flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
