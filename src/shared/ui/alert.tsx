import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

import { alertVariants } from './alert-variants'

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

/**
 * Блок предупреждения.
 *
 * Роль `alert` назначается только вариантам `warning` и `danger`:
 * программы чтения с экрана прерывают чтение при появлении такого
 * элемента, и назначать эту роль нейтральному пояснению значит
 * приучать пользователя к прерываниям без причины.
 */
export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={variant === 'default' || variant === undefined ? undefined : 'alert'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium tracking-tight', className)}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 text-sm text-muted-foreground [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
}
