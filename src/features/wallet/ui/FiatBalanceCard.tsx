import { type ReactNode } from 'react'

import { useTranslation } from '@/shared/i18n'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/shared/ui'

import { formatDisplayFiat, type IFiatRates } from '../lib/display-currency'
import { useDisplayCurrency } from '../model/display-currency-context'
import { CurrencySwitch } from './CurrencySwitch'
import { useFiatRates } from './useFiatRates'

interface FiatBalanceCardProps {
  /** Каноническая сумма в долларах. `null` — величина неизвестна. */
  readonly amountUsd: number | null

  readonly isRefreshing?: boolean

  /**
   * Готовые курсы. Боевой код их не передаёт: карточка сама спрашивает
   * источник. Тест подставляет, чтобы не ждать сеть и не зависеть от
   * заглушки `fetch`.
   */
  readonly rates?: IFiatRates

  readonly action?: ReactNode
}

/**
 * Баланс справочного аккаунта: фиат, а не монеты.
 *
 * СУММА СЧИТАЕТСЯ НА КЛИЕНТЕ: остатки записи × живой курс.
 * Карточка не хранит доллары — только показывает оценку.
 */
export function FiatBalanceCard({
  amountUsd,
  isRefreshing = false,
  rates: ratesOverride,
  action,
}: FiatBalanceCardProps) {
  const { t } = useTranslation()
  const { currency, setCurrency, formatUsd } = useDisplayCurrency()
  const fetchedRates = useFiatRates()
  const rates = ratesOverride ?? fetchedRates
  const displayAmount =
    ratesOverride === undefined
      ? formatUsd(amountUsd)
      : formatDisplayFiat(amountUsd, currency, rates)

  return (
    <Card className="surface-hero gap-4 shadow-raised inset-shadow-hairline">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <CurrencySwitch value={currency} onChange={setCurrency} />

          <CardTitle
            as="h1"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {t('dashboard.balance')}
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4" aria-busy={isRefreshing}>
        <div className="flex min-h-10 items-center text-4xl leading-none font-semibold tracking-tight break-all tabular-nums sm:min-h-12 sm:text-5xl">
          {amountUsd === null && isRefreshing ? (
            <>
              <Skeleton className="h-10 w-52 sm:h-12" />
              <span className="sr-only">{t('dashboard.valueLoading')}</span>
            </>
          ) : (
            displayAmount
          )}
        </div>

        {action}
      </CardContent>
    </Card>
  )
}
