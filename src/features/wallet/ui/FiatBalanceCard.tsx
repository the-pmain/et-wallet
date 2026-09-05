import { type ReactNode } from 'react'

import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { formatDisplayFiat, type IFiatRates } from '../lib/display-currency'
import { useDisplayCurrency } from '../model/display-currency-context'
import { BalanceAmountSlot } from './BalanceAmountSlot'
import { CurrencySwitch } from './CurrencySwitch'
import { useFiatRates } from './useFiatRates'

interface FiatBalanceCardProps {
  /** Canonical amount in dollars. `null` means the value is unknown. */
  readonly amountUsd: number | null

  readonly isRefreshing?: boolean

  /**
   * Ready-made rates. Production does not pass them: the card fetches
   * itself. Tests inject so they do not wait on the network or a
   * stubbed `fetch`.
   */
  readonly rates?: IFiatRates

  readonly action?: ReactNode
}

/**
 * Reference-account balance: fiat, not coins.
 *
 * The amount is computed on the client (record balances × live rate).
 * The card does not store dollars — it only displays the estimate.
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
    <Card
      className={cn(
        'surface-hero gap-4 shadow-raised inset-shadow-hairline',
        'max-lg:gap-5 max-lg:border-transparent max-lg:bg-transparent max-lg:py-2 max-lg:shadow-none max-lg:[background-image:none]',
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 max-lg:flex-col max-lg:items-center max-lg:px-0">
        <div className="flex min-w-0 flex-col gap-3 max-lg:items-center">
          <CurrencySwitch value={currency} onChange={setCurrency} />

          <CardTitle
            as="h1"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {t('dashboard.balance')}
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent
        className="flex flex-col gap-4 max-lg:items-center max-lg:px-0 max-lg:text-center"
        aria-busy={isRefreshing}
      >
        <BalanceAmountSlot
          isLoading={amountUsd === null && isRefreshing}
          loadingLabel={t('dashboard.valueLoading')}
          className="max-lg:justify-center"
        >
          {displayAmount}
        </BalanceAmountSlot>

        {action}
      </CardContent>
    </Card>
  )
}
