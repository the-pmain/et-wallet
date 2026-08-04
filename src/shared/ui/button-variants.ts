import { cva } from 'class-variance-authority'

/**
 * Варианты оформления кнопки.
 *
 * Вынесены в отдельный файл от компонента сознательно: React Fast Refresh
 * корректно работает только тогда, когда модуль экспортирует исключительно
 * компоненты. Соседство компонента и обычной функции в одном файле ломает
 * горячую перезагрузку и приводит к полной перезагрузке страницы при правках.
 *
 * Отличие от поставки shadcn/ui: у варианта `destructive` усилено фокус-кольцо.
 * Подтверждение необратимых операций — отправка средств, удаление аккаунта —
 * должно визуально отличаться от обычных действий, в том числе при навигации
 * с клавиатуры.
 */
export const buttonVariants = cva(
  /* `cursor-pointer` задан явно: Tailwind сбрасывает курсор кнопки
     к стрелке, и элемент перестаёт выглядеть нажимаемым.

     `active:scale` — отклик на нажатие. Мгновенная смена состояния без
     отклика читается как «не нажалось», и пользователь жмёт второй раз;
     в кошельке второе нажатие по «Отправить» стоит дорого. Движение
     снимается при `prefers-reduced-motion`. */
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/40',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary-emphasis underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
