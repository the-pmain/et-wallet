import { cva } from 'class-variance-authority'

/**
 * Варианты оформления предупреждения.
 *
 * Вынесены в отдельный файл от компонента: React Fast Refresh корректно
 * работает только когда модуль экспортирует исключительно компоненты.
 *
 * Уровни соответствуют цветам риска из дизайн-токенов и применяются
 * последовательно во всём приложении: пользователь должен различать
 * пояснение и предупреждение о необратимом действии по одному взгляду,
 * не читая текст.
 */
export const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        /** Нейтральное пояснение. */
        default: 'bg-card text-card-foreground',
        /** Обратимое затруднение: неверный ввод, недоступная сеть. */
        warning: 'border-risk-medium/40 bg-risk-medium/10 text-foreground [&>svg]:text-risk-medium',
        /** Необратимое действие либо потеря доступа к средствам. */
        danger: 'border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)
