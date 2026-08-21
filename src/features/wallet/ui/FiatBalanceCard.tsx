import { useState, type ReactNode } from 'react'

import { useTranslation } from '@/shared/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import {
  DISPLAY_CURRENCY,
  formatDisplayFiat,
  type DisplayCurrency,
  type IFiatRates,
} from '../lib/display-currency'
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
 * СУММА НА СЕРВЕРЕ УЖЕ В ДОЛЛАРАХ. Это не оценка эфира и не курс
 * стороннего сервиса к нативной валюте — это записанная величина.
 * Поэтому она стоит самым крупным числом, а переключатель валют
 * меняет только подпись.
 */
export function FiatBalanceCard({
  amountUsd,
  isRefreshing = false,
  rates: ratesOverride,
  action,
}: FiatBalanceCardProps) {
  const { t } = useTranslation()
  const fetchedRates = useFiatRates()
  const rates = ratesOverride ?? fetchedRates
  const [currency, setCurrency] = useState<DisplayCurrency>(DISPLAY_CURRENCY.Usd)

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
        <p className="text-4xl leading-none font-semibold tracking-tight break-all tabular-nums sm:text-5xl">
          {formatDisplayFiat(amountUsd, currency, rates)}
        </p>

        {action}
      </CardContent>
    </Card>
  )
}
