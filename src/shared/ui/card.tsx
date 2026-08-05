import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/** Контейнер карточки shadcn/ui (стиль new-york). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        /* Тень из шкалы глубины вместо `shadow-sm`: та была одинаковой
           у всех карточек и не отделяла их от фона на тёмной теме. */
        'flex flex-col gap-6 rounded-xl border border-border/70 bg-card py-6 text-card-foreground shadow-surface',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1.5 px-6', className)}
      {...props}
    />
  )
}

/** Допустимые уровни заголовка карточки. */
type CardTitleLevel = 'h1' | 'h2' | 'h3'

/**
 * Заголовок карточки.
 *
 * УРОВЕНЬ ЗАДАЁТСЯ МЕСТОМ, А НЕ КОМПОНЕНТОМ. Жёсткий `h2` внутри общей
 * карточки означает, что порядок заголовков страницы определяет не автор
 * страницы, а библиотека: экран, где карточка несёт главный смысл,
 * оставался без заголовка первого уровня, и обход по заголовкам
 * начинался с середины иерархии.
 */
export function CardTitle({
  className,
  as: Component = 'h2',
  ...props
}: ComponentProps<'h2'> & { readonly as?: CardTitleLevel }) {
  return (
    <Component
      data-slot="card-title"
      className={cn('text-xl leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card-footer" className={cn('flex items-center px-6', className)} {...props} />
  )
}
