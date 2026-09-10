import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Base shadcn/ui input (new-york style).
 *
 * Difference from the library default: `spellCheck` is off. Browser
 * spell-check sends field contents to external services at some
 * vendors, and this wallet's fields hold passwords, seed phrases, and
 * addresses. Spell-check can be turned on explicitly where it belongs.
 */
export function Input({ className, type, spellCheck = false, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      spellCheck={spellCheck}
      className={cn(
        'flex h-10 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
        'file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground',
        'focus-ring',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
