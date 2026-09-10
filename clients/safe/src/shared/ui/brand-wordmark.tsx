import { APP_CONFIG } from '@/shared/config'
import { cn } from '@/shared/lib/utils'

interface BrandWordmarkProps {
  readonly className?: string
}

/**
 * Product name next to the mark.
 *
 * Rubik only here — a rounded geometric cut in the same family as
 * MetaMask's wordmark. The cabinet stays Inter.
 */
export function BrandWordmark({ className }: BrandWordmarkProps) {
  return (
    <span
      className={cn(
        'font-display text-[1.2rem] font-bold tracking-[0.03em] whitespace-nowrap text-foreground',
        className,
      )}
    >
      {APP_CONFIG.brandLabel}
    </span>
  )
}
