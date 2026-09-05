import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        /* Shadow from the depth scale instead of `shadow-sm`: that
           one was the same on every card and did not lift them off
           the dark-theme background. */
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

type CardTitleLevel = 'h1' | 'h2' | 'h3'

/**
 * Card heading.
 *
 * THE LEVEL IS SET BY THE PLACE, NOT THE COMPONENT. A hard-coded `h2`
 * inside a shared card means the page heading order is decided by the
 * library, not the page author: a screen where the card carries the
 * main meaning stayed without an h1, and heading navigation started
 * in the middle of the hierarchy.
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
