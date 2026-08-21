import { useEffect, useState } from 'react'

import { FiatRatesClient } from '@/core'
import { USD_ONLY_RATES, type IFiatRates } from '../lib/display-currency'

const client = new FiatRatesClient()

/**
 * Курсы EUR и GBP к доллару. Пока ответа нет — единица, то есть
 * показ остаётся в долларовом номинале, а не в выдуманном курсе.
 */
export function useFiatRates(): IFiatRates {
  const [rates, setRates] = useState<IFiatRates>(USD_ONLY_RATES)

  useEffect(() => {
    const controller = new AbortController()

    void client
      .getRates(controller.signal)
      .then((fetched) => {
        if (controller.signal.aborted) {
          return
        }

        setRates({ USD: 1, EUR: fetched.EUR, GBP: fetched.GBP })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return
        }

        console.error(error)
      })

    return () => {
      controller.abort()
    }
  }, [])

  return rates
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
