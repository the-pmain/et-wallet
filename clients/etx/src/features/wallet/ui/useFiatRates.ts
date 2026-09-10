import { useEffect, useSyncExternalStore } from 'react'

import { USD_ONLY_RATES, type IFiatRates } from '../lib/display-currency'
import { appFiatRates } from '../model/fiat-rates-cache'

/**
 * Курсы EUR и GBP к доллару. Пока ответа нет — единица, то есть
 * показ остаётся в долларовом номинале, а не в выдуманном курсе.
 *
 * Запрос один на приложение: карточка баланса и переключение валюты
 * не ходят к источнику повторно.
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
