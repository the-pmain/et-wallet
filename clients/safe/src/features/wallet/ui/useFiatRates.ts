import { useEffect, useSyncExternalStore } from 'react'

import { USD_ONLY_RATES, type IFiatRates } from '../lib/display-currency'
import { appFiatRates } from '../model/fiat-rates-cache'

/**
 * EUR and GBP rates against the dollar. Until a reply arrives the
 * rate is 1, so the display stays at the dollar face value rather
 * than an invented rate.
 *
 * One request per app: the balance card and the currency switch do
 * not hit the source again.
 */
export function useFiatRates(): IFiatRates {
  const rates = useSyncExternalStore(
    (onStoreChange) => appFiatRates.subscribe(onStoreChange),
    () => appFiatRates.getSnapshot(),
    () => USD_ONLY_RATES,
  )

  useEffect(() => {
    void appFiatRates.ensureLoaded()
  }, [])

  return rates
}
