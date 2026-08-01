import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Заполнитель на время загрузки.
 *
 * ПОЧЕМУ НЕ ПОКАЗЫВАЕТСЯ ВМЕСТО ЧИСЛОВЫХ ЗНАЧЕНИЙ. Заполнитель на месте
 * баланса выглядит как «сейчас будет число» и подталкивает дождаться его,
 * не заметив, что данные так и не пришли. Для сумм используется явное
 * состояние с текстом. Заполнитель уместен там, где отсутствие данных
 * ничего не решает: списки, заголовки, оформление.
 *
 * `aria-hidden`: экранному диктору нечего зачитывать, а состояние загрузки
 * сообщается текстом рядом.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
