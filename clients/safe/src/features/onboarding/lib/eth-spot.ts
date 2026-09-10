import {
  FIAT_CURRENCY,
  fetchCoinbaseEthUsd,
  priceRefKey,
  type IPriceProvider,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
  type Timestamp,
} from '@/core'

export { fetchCoinbaseEthUsd }

export function nativeEthQuotes(refs: readonly IPriceRef[], ethUsd: number): PriceMap {
  const quotes = new Map<string, IPriceQuote>()
  const updatedAt = Date.now() as Timestamp

  for (const ref of refs) {
    if (ref.address !== null) {
      continue
    }

    quotes.set(priceRefKey(ref), {
      price: ethUsd,
      change24hPercent: null,
      updatedAt,
    })
  }

  return quotes
}

export async function quotesWithEthFallback(
  refs: readonly IPriceRef[],
  provider: Pick<IPriceProvider, 'getPrices'>,
): Promise<PriceMap> {
  try {
    return await provider.getPrices(refs, FIAT_CURRENCY.Usd)
  } catch {
    const ethUsd = await fetchCoinbaseEthUsd()

    if (ethUsd === null) {
      return new Map()
    }

    return nativeEthQuotes(refs, ethUsd)
  }
}
