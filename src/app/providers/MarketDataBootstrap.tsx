import { useEffect, type ReactNode } from 'react'

import { appMarketCatalog } from '@/core'

import { appFiatRates } from '@/features/wallet/model/fiat-rates-cache'

/**
 * Поднимает курсы рынка и фиата один раз при открытии приложения.
 *
 * Карточки экрана только читают снимок. Без этого запроса каждая из них
 * ходила бы к CoinGecko отдельно — и упиралась в лимит ещё до показа.
 */
export function MarketDataBootstrap({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    void appMarketCatalog.ensureLoaded()
    void appFiatRates.ensureLoaded()
  }, [])

  return children
}
