import type { ChainId } from '@/core/types'

import { findCoinGeckoPlatform } from './coingecko-platforms'
import type { IPriceProvider } from './contracts'
import type { MarketCatalog } from './MarketCatalog'
import type { FiatCurrency, IPriceRef, PriceMap } from './types'

/**
 * Rates from an already loaded market snapshot.
 *
 * DOES NOT HIT THE NETWORK. `getPrices` waits for the single
 * `/coins/markets` request and parses it. Later portfolio walks,
 * wallet changes, and showcase valuation do not spawn new CoinGecko
 * calls.
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
