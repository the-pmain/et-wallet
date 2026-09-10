import type { ChainId } from '@/core/types'

import { findCoinGeckoPlatform } from './coingecko-platforms'
import type { IPriceProvider } from './contracts'
import type { MarketCatalog } from './MarketCatalog'
import type { FiatCurrency, IPriceRef, PriceMap } from './types'

/**
 * Курсы из уже загруженного снимка рынка.
 *
 * СЕТИ НЕ ХОДИТ. `getPrices` ждёт единственный запрос `/coins/markets`
 * и разбирает его. Повторные обходы портфеля, смена кошелька и оценка
 * витрины не порождают новых обращений к CoinGecko.
 */
export class CatalogPriceProvider implements IPriceProvider {
  readonly id = 'coingecko'
  readonly name = 'CoinGecko'

  readonly #catalog: MarketCatalog

  constructor(catalog: MarketCatalog) {
    this.#catalog = catalog
  }

  supports(chainId: ChainId): boolean {
    return findCoinGeckoPlatform(chainId) !== null
  }

  async getPrices(refs: readonly IPriceRef[], _currency: FiatCurrency): Promise<PriceMap> {
    await this.#catalog.ensureLoaded()

    return this.#catalog.quotesForAssets(refs)
  }
}
