import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Базовое поле ввода shadcn/ui (стиль new-york).
 *
 * Отличие от поставки библиотеки: `spellCheck` выключён по умолчанию.
 * Проверка орфографии в браузере отправляет содержимое поля во внешние
 * службы у части поставщиков, а поля этого кошелька содержат пароли,
 * seed-фразы и адреса. Включить проверку можно явно, там где это уместно.
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
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
