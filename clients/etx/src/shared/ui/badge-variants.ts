import { cva } from 'class-variance-authority'

/**
 * Варианты оформления метки.
 *
 * Вынесены в отдельный файл от компонента: React Fast Refresh корректно
 * работает только тогда, когда модуль экспортирует исключительно компоненты.
 *
 * Набор вариантов повторяет смысловые уровни палитры. Отдельного «синего»
 * или «зелёного» варианта нет намеренно: цвет в кошельке означает уровень
 * риска, и метка, окрашенная ради красоты, размывает это значение.
 */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary-emphasis',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        warning: 'border-transparent bg-risk-medium/15 text-risk-medium',
        danger: 'border-transparent bg-destructive/15 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)
