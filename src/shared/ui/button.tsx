import { Slot } from '@radix-ui/react-slot'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

import { buttonVariants } from './button-variants'

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /**
     * Отрисовать стили кнопки на дочернем элементе вместо `<button>`.
     * Нужно, когда семантически требуется ссылка, а визуально — кнопка.
     */
    asChild?: boolean
  }

/** Базовая кнопка shadcn/ui (стиль new-york). */
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}
