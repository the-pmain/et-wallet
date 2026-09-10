import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'

interface AmountWithUnitProps {
  readonly amount: string
  readonly unit: string
  readonly className?: string
}

/**
 * Сумма вместе с обозначением.
 *
 * Голое число в списке читается как счётчик, не как деньги.
 * Обозначение рядом снимает двусмысленность: `2` — это `2 USDT`.
 */
export function AmountWithUnit({ amount, unit, className }: AmountWithUnitProps) {
  const symbol = unit.trim()
  const label = symbol === '' ? amount : `${amount} ${symbol}`

  return <UntrustedText value={label} className={cn('tabular-nums', className)} />
}
