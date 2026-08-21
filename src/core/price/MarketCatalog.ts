import type { Timestamp } from '@/core/types'

import { fetchCoinbaseEthUsd } from './coinbase-spot'
import { CoinGeckoMarketClient } from './CoinGeckoMarketClient'
import { findCoinGeckoPlatform } from './coingecko-platforms'
import { knownMarketCoinId } from './known-market-tokens'
import type { IMarketCoin } from './markets'
import { priceRefKey, type IPriceQuote, type IPriceRef, type PriceMap } from './types'

export type MarketCatalogStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface IMarketCatalogSnapshot {
  readonly status: MarketCatalogStatus
  readonly coins: readonly IMarketCoin[]
}

export interface IMarketAssetRef extends IPriceRef {
  readonly symbol?: string
}

export interface IMarketCatalogOptions {
  readonly loadMarkets?: (signal?: AbortSignal) => Promise<readonly IMarketCoin[]>
  readonly loadEthUsd?: () => Promise<number | null>
}

const EMPTY_SNAPSHOT: IMarketCatalogSnapshot = { status: 'idle', coins: [] }

/**
 * Один снимок публичного рынка на всё приложение.
 *
 * ЗАПРОС УХОДИТ ОДИН РАЗ. Бесплатный CoinGecko отвечает 429 уже на
 * несколько обращений: отдельный `simple/price` на каждый кошелёк
 * и на каждую карточку рынка съедал лимит до показа долларов.
 * `/coins/markets` даёт и таблицу курсов, и цены нативных монет.
 */
export class MarketCatalog {
  #loadMarkets: (signal?: AbortSignal) => Promise<readonly IMarketCoin[]>
  #loadEthUsd: () => Promise<number | null>

  #status: MarketCatalogStatus = 'idle'
  #coins: readonly IMarketCoin[] = []
  #quotedAt: Timestamp = 0 as Timestamp
  #load: Promise<void> | null = null
  #generation = 0
  #snapshot: IMarketCatalogSnapshot = EMPTY_SNAPSHOT

  readonly #byId = new Map<string, IMarketCoin>()
  readonly #bySymbol = new Map<string, IMarketCoin>()
  readonly #listeners = new Set<() => void>()

  constructor(options: IMarketCatalogOptions = {}) {
    this.#loadMarkets =
      options.loadMarkets ?? ((signal) => new CoinGeckoMarketClient().getMarkets(signal))
    this.#loadEthUsd = options.loadEthUsd ?? fetchCoinbaseEthUsd
  }

  configure(options: IMarketCatalogOptions): void {
    if (this.#status !== 'idle') {
      return
    }

    if (options.loadMarkets !== undefined) {
      this.#loadMarkets = options.loadMarkets
    }

    if (options.loadEthUsd !== undefined) {
      this.#loadEthUsd = options.loadEthUsd
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot(): IMarketCatalogSnapshot {
    return this.#snapshot
  }

  get status(): MarketCatalogStatus {
    return this.#status
  }

  get coins(): readonly IMarketCoin[] {
    return this.#coins
  }

  get isLoading(): boolean {
    return this.#status === 'idle' || this.#status === 'loading'
  }

  hydrate(coins: readonly IMarketCoin[]): void {
    this.#generation += 1
    this.#load = Promise.resolve()
    this.#apply(coins, 'ready')
  }

  reset(): void {
    this.#generation += 1
    this.#load = null
    this.#coins = []
    this.#status = 'idle'
    this.#quotedAt = 0 as Timestamp
    this.#byId.clear()
    this.#bySymbol.clear()
    this.#snapshot = EMPTY_SNAPSHOT
    this.#notify()
  }

  retry(): Promise<void> {
    if (this.#status !== 'failed') {
      return this.ensureLoaded()
    }

    this.#load = null
    this.#status = 'idle'
    this.#snapshot = EMPTY_SNAPSHOT
    this.#notify()

    return this.ensureLoaded()
  }

  async ensureLoaded(): Promise<void> {
    if (this.#status === 'ready' || this.#status === 'failed') {
      return this.#load ?? Promise.resolve()
    }

    if (this.#load !== null) {
      return this.#load
    }

    this.#status = 'loading'
    this.#publish()
    this.#load = this.#run()

    return this.#load
  }

  quoteForRef(ref: IPriceRef): IPriceQuote | undefined {
    return this.quotesForAssets([ref]).get(priceRefKey(ref))
  }

  quotesForAssets(refs: readonly IMarketAssetRef[]): PriceMap {
    const quotes = new Map<string, IPriceQuote>()

    for (const ref of refs) {
      const quote = this.#quoteForAsset(ref)

      if (quote !== undefined) {
        quotes.set(priceRefKey(ref), quote)
      }
    }

    return quotes
  }

  async #run(): Promise<void> {
    const generation = this.#generation

    try {
      const coins = await this.#loadMarkets()

      if (generation !== this.#generation) {
        return
      }

      this.#apply(coins, 'ready')
    } catch {
      if (generation !== this.#generation) {
        return
      }

      const fallback = await this.#ethereumFallback()

      if (generation !== this.#generation) {
        return
      }

      this.#apply(fallback, fallback.length > 0 ? 'ready' : 'failed')
    }
  }

  async #ethereumFallback(): Promise<readonly IMarketCoin[]> {
    const ethUsd = await this.#loadEthUsd()

    if (ethUsd === null) {
      return []
    }

    return [
      {
        id: 'ethereum',
        symbol: 'ETH',
        name: 'Ethereum',
        rank: 2,
        priceUsd: ethUsd,
        change1hPercent: null,
        change24hPercent: null,
        change7dPercent: null,
        volume24hUsd: null,
        marketCapUsd: null,
      },
    ]
  }

  #apply(
    coins: readonly IMarketCoin[],
    status: Exclude<MarketCatalogStatus, 'idle' | 'loading'>,
  ): void {
    this.#coins = coins
    this.#status = status
    this.#quotedAt = Date.now() as Timestamp
    this.#index(coins)
    this.#publish()
  }

  #index(coins: readonly IMarketCoin[]): void {
    this.#byId.clear()
    this.#bySymbol.clear()

    for (const coin of coins) {
      this.#byId.set(coin.id, coin)

      const symbol = coin.symbol.toUpperCase()

      if (!this.#bySymbol.has(symbol)) {
        this.#bySymbol.set(symbol, coin)
      }
    }
  }

  #quoteForAsset(ref: IMarketAssetRef): IPriceQuote | undefined {
    if (ref.address === null) {
      const platform = findCoinGeckoPlatform(ref.chainId)
      const coin = platform === null ? undefined : this.#byId.get(platform.nativeCoinId)

      return coin === undefined ? undefined : this.#toQuote(coin)
    }

    const knownId = knownMarketCoinId(ref.chainId, ref.address)
    const byId = knownId === null ? undefined : this.#byId.get(knownId)

    if (byId !== undefined) {
      return this.#toQuote(byId)
    }

    if (ref.symbol === undefined || ref.symbol.trim() === '') {
      return undefined
    }

    const bySymbol = this.#bySymbol.get(ref.symbol.toUpperCase())

    return bySymbol === undefined ? undefined : this.#toQuote(bySymbol)
  }

  #toQuote(coin: IMarketCoin): IPriceQuote | undefined {
    if (coin.priceUsd === null || coin.priceUsd <= 0) {
      return undefined
    }

    return {
      price: coin.priceUsd,
      change24hPercent: coin.change24hPercent,
      updatedAt: this.#quotedAt,
    }
  }

  #publish(): void {
    this.#snapshot = { status: this.#status, coins: this.#coins }
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }
}
