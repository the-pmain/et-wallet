import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

import { alertVariants } from './alert-variants'

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

/**
 * Warning block.
 *
 * The `alert` role is assigned only to `warning` and `danger`:
 * screen readers interrupt reading when such an element appears,
 * and giving that role to a neutral note trains the user to ignore
 * interruptions.
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
