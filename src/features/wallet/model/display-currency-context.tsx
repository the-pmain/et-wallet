import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import {
  DISPLAY_CURRENCY,
  formatDisplayFiat,
  type DisplayCurrency,
} from '../lib/display-currency'
import { useFiatRates } from '../ui/useFiatRates'

interface IDisplayCurrencyContext {
  readonly currency: DisplayCurrency
  readonly setCurrency: (currency: DisplayCurrency) => void
  readonly formatUsd: (amountUsd: number | null) => string
}

const DisplayCurrencyContext = createContext<IDisplayCurrencyContext | null>(null)

/** Shared USD/EUR/GBP display currency for wallet screens. */
export function DisplayCurrencyProvider({ children }: { readonly children: ReactNode }) {
  const rates = useFiatRates()
  const [currency, setCurrency] = useState<DisplayCurrency>(DISPLAY_CURRENCY.Usd)

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      formatUsd: (amountUsd: number | null) => formatDisplayFiat(amountUsd, currency, rates),
    }),
    [currency, rates],
  )

  return (
    <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
  )
}

export function useDisplayCurrency(): IDisplayCurrencyContext {
  const context = useContext(DisplayCurrencyContext)

  if (context === null) {
    throw new Error('useDisplayCurrency must be used within DisplayCurrencyProvider.')
  }

  return context
}
