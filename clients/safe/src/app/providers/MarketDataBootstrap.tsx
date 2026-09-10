import { useEffect, type ReactNode } from 'react'

import { appMarketCatalog } from '@/core'

import { appFiatRates } from '@/features/wallet/model/fiat-rates-cache'

/**
 * Loads market and fiat rates once when the app opens.
 *
 * Screen cards only read the snapshot. Without this request each of
 * them would hit CoinGecko separately — and hit the limit before
 * anything is shown.
 */
export function MarketDataBootstrap({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    void appMarketCatalog.ensureLoaded()
    void appFiatRates.ensureLoaded()
  }, [])

  return children
}
