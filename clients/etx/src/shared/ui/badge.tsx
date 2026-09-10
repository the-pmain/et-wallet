import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

import { badgeVariants } from './badge-variants'

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

/**
 * Короткая метка состояния.
 *
 * Элемент `span`, а не `div`: метка встречается внутри строк текста
 * и внутри кнопок, где блочный элемент нарушил бы поток.
 */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
