import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { toChainId } from '@/core/types'

import { CoinGeckoPriceProvider } from './CoinGeckoPriceProvider'
import { FIAT_CURRENCY, priceRefKey, type IPriceRef } from './types'

const ETHEREUM = toChainId(1n)
const UNKNOWN_CHAIN = toChainId(999_999n)

const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const WBTC = toAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')

const NATIVE: IPriceRef = { chainId: ETHEREUM, address: null }
const USDC_REF: IPriceRef = { chainId: ETHEREUM, address: USDC }
const WBTC_REF: IPriceRef = { chainId: ETHEREUM, address: WBTC }

/** Requested URLs: used to check exactly what went out. */
let requested: string[]

/** Replies by path fragment for every request. */
let responder: (url: string) => { status: number; body: unknown }

function createProvider(contractBatchSize = 10) {
  return new CoinGeckoPriceProvider({
    baseUrl: 'https://prices.test/api/v3',
    contractBatchSize,
    /* The provider always passes the address as a string: the
       `fetch` signature is wider, but narrowing it here is safe —
       this is the only call site. */
    fetchImpl: ((input: string) => {
      const url = input

      requested.push(url)

      const { status, body } = responder(url)

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as typeof fetch,
  })
}

beforeEach(() => {
  requested = []
  responder = () => ({ status: 200, body: {} })
})

describe('CoinGecko: network support', () => {
  it('supports built-in networks', () => {
    const provider = createProvider()

    expect(provider.supports(ETHEREUM)).toBe(true)
    expect(provider.supports(toChainId(8453n))).toBe(true)
  })

  it('does not support a network outside the list', () => {
    /* Substituting a similar platform would show the rate of a
       foreign asset. */
    expect(createProvider().supports(UNKNOWN_CHAIN)).toBe(false)
  })

  it('does not call the service for an unsupported network', () => {
    const provider = createProvider()

    return provider
      .getPrices([{ chainId: UNKNOWN_CHAIN, address: null }], FIAT_CURRENCY.Usd)
      .then((result) => {
        expect(result.size).toBe(0)
        expect(requested).toEqual([])
      })
  })
})

describe('CoinGecko: native currency', () => {
  it('requests the rate by coin id', async () => {
    responder = () => ({
      status: 200,
      body: { ethereum: { usd: 1864, usd_24h_change: -2.95, last_updated_at: 1_785_507_970 } },
    })

    const result = await createProvider().getPrices([NATIVE], FIAT_CURRENCY.Usd)
    const quote = result.get(priceRefKey(NATIVE))

    expect(quote?.price).toBe(1864)
    expect(quote?.change24hPercent).toBeCloseTo(-2.95, 6)
    expect(requested[0]).toContain('ids=ethereum')
  })

  it('converts the quote instant from seconds to milliseconds', async () => {
    responder = () => ({
      status: 200,
      body: { ethereum: { usd: 1864, last_updated_at: 1_785_507_970 } },
    })

    const result = await createProvider().getPrices([NATIVE], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(NATIVE))?.updatedAt).toBe(1_785_507_970_000)
  })
})

describe('CoinGecko: tokens', () => {
  it('requests rates by contract addresses', async () => {
    responder = () => ({
      status: 200,
      body: { [USDC.toLowerCase()]: { usd: 1.0001, usd_24h_change: 0.01 } },
    })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(USDC_REF))?.price).toBeCloseTo(1.0001, 8)
    expect(requested[0]).toContain('token_price/ethereum')
  })

  it('only the contract address enters the request, and no one else\'s', async () => {
    /* The method does not accept a wallet address and cannot pass
       it. The service learns the portfolio composition, but not
       whose it is. */
    responder = () => ({ status: 200, body: {} })

    await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    const addresses = (requested[0] ?? '').match(/0x[0-9a-f]{40}/giu) ?? []

    expect(addresses.map((item) => item.toLowerCase())).toEqual([USDC.toLowerCase()])
  })

  it('splits the request into chunks of the given size', async () => {
    /* Free access accepts one address per request: a batch larger
       than one is refused with code 10012. */
    responder = () => ({ status: 200, body: {} })

    await createProvider(1).getPrices([USDC_REF, WBTC_REF], FIAT_CURRENCY.Usd)

    expect(requested).toHaveLength(2)
  })

  it('sends several addresses in one request when the batch is larger', async () => {
    responder = () => ({ status: 200, body: {} })

    await createProvider(10).getPrices([USDC_REF, WBTC_REF], FIAT_CURRENCY.Usd)

    expect(requested).toHaveLength(1)
  })
})

describe('CoinGecko: unknown is not replaced with zero', () => {
  it('a missing record means an unknown rate', async () => {
    /* The service replies with an empty object for an unknown
       contract — without an error. Zero here would declare the
       asset worth nothing. */
    responder = () => ({ status: 200, body: {} })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.has(priceRefKey(USDC_REF))).toBe(false)
  })

  it('zero and negative prices are rejected', () => {
    responder = () => ({ status: 200, body: { [USDC.toLowerCase()]: { usd: 0 } } })

    return createProvider()
      .getPrices([USDC_REF], FIAT_CURRENCY.Usd)
      .then((result) => {
        expect(result.has(priceRefKey(USDC_REF))).toBe(false)
      })
  })

  it('a missing daily change is not replaced with zero', async () => {
    responder = () => ({ status: 200, body: { [USDC.toLowerCase()]: { usd: 1 } } })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(USDC_REF))?.change24hPercent).toBeNull()
  })
})

describe('CoinGecko: refusals', () => {
  it('recognises an error in the reply body with status 200', async () => {
    /* Exceeding the address limit arrives that way. Without
       checking the `error_code` field such a reply would be parsed
       as "there are no rates". */
    responder = () => ({
      status: 200,
      body: {
        error_code: 10012,
        status: { error_message: 'Number of contract addresses exceeds the allowed limit' },
      },
    })

    await expect(createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)).rejects.toThrow(
      /allowed limit/u,
    )
  })

  it('keeps the status code in the refusal message', async () => {
    /* A rate limit is fixed by waiting, exceeding the address
       limit by a setting: a generic "source unavailable" instead
       of the code does not say what to do. */
    responder = () => ({ status: 429, body: {} })

    await expect(createProvider().getPrices([NATIVE], FIAT_CURRENCY.Usd)).rejects.toThrow(/429/u)
  })

  it('a partial refusal does not cancel what was obtained', async () => {
    /* The ether rate is useful even when a token price could not
       be obtained. */
    responder = (url) =>
      url.includes('token_price')
        ? { status: 500, body: {} }
        : { status: 200, body: { ethereum: { usd: 1864 } } }

    const result = await createProvider(1).getPrices([NATIVE, USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(NATIVE))?.price).toBe(1864)
    expect(result.has(priceRefKey(USDC_REF))).toBe(false)
  })
})
