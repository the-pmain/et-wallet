import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'

interface AmountWithUnitProps {
  readonly amount: string
  readonly unit: string
  readonly className?: string
}

/**
 * Amount together with its unit.
 *
 * A bare number in a list reads as a counter, not as money.
 * The unit beside it removes the ambiguity: `2` is `2 USDT`.
 */
export function AmountWithUnit({ amount, unit, className }: AmountWithUnitProps) {
  const symbol = unit.trim()
  const label = symbol === '' ? amount : `${amount} ${symbol}`

  return <UntrustedText value={label} className={cn('tabular-nums', className)} />
}
