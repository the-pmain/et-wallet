import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Multiline input.
 *
 * Like `Input`, spell-check is off by default: a seed phrase is typed
 * here, and sending that content to an external spelling service would
 * mean losing the wallet.
 */
export function Textarea({ className, spellCheck = false, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      spellCheck={spellCheck}
      className={cn(
        'flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground',
        'focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
