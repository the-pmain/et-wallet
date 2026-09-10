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

/** Запрошенные адреса: позволяют проверить, что именно ушло наружу. */
let requested: string[]

/** Ответы по частям пути the time of every request. */
let responder: (url: string) => { status: number; body: unknown }

function createProvider(contractBatchSize = 10) {
  return new CoinGeckoPriceProvider({
    baseUrl: 'https://prices.test/api/v3',
    contractBatchSize,
    /* Провайдер всегда передаёт адрес строкой: подпись `fetch` шире,
       но сужать её здесь безопасно — это единственное место вызова. */
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

describe('CoinGecko: поддержка сетей', () => {
  it('поддерживает встроенные сети', () => {
    const provider = createProvider()

    expect(provider.supports(ETHEREUM)).toBe(true)
    expect(provider.supports(toChainId(8453n))).toBe(true)
  })

  it('не поддерживает сеть вне перечня', () => {
    /* Подставить похожую платформу значило бы показать курс чужого
       актива. */
    expect(createProvider().supports(UNKNOWN_CHAIN)).toBe(false)
  })

  it('не обращается к сервису за неподдерживаемой сетью', () => {
    const provider = createProvider()

    return provider
      .getPrices([{ chainId: UNKNOWN_CHAIN, address: null }], FIAT_CURRENCY.Usd)
      .then((result) => {
        expect(result.size).toBe(0)
        expect(requested).toEqual([])
      })
  })
})

describe('CoinGecko: нативная валюта', () => {
  it('запрашивает курс по идентификатору монеты', async () => {
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

  it('переводит момент котировки из секунд в миллисекунды', async () => {
    responder = () => ({
      status: 200,
      body: { ethereum: { usd: 1864, last_updated_at: 1_785_507_970 } },
    })

    const result = await createProvider().getPrices([NATIVE], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(NATIVE))?.updatedAt).toBe(1_785_507_970_000)
  })
})

describe('CoinGecko: токены', () => {
  it('запрашивает курсы по адресам контрактов', async () => {
    responder = () => ({
      status: 200,
      body: { [USDC.toLowerCase()]: { usd: 1.0001, usd_24h_change: 0.01 } },
    })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(USDC_REF))?.price).toBeCloseTo(1.0001, 8)
    expect(requested[0]).toContain('token_price/ethereum')
  })

  it('в запрос попадает только адрес контракта и ничей больше', async () => {
    /* Адрес кошелька метод не принимает и передать его не может.
       Сервис узнаёт состав портфеля, но не то, чей он. */
    responder = () => ({ status: 200, body: {} })

    await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    const addresses = (requested[0] ?? '').match(/0x[0-9a-f]{40}/giu) ?? []

    expect(addresses.map((item) => item.toLowerCase())).toEqual([USDC.toLowerCase()])
  })

  it('разбивает запрос на части заданного размера', async () => {
    /* Бесплатный доступ принимает один адрес за запрос: пакет больше
       единицы отвергается с кодом 10012. */
    responder = () => ({ status: 200, body: {} })

    await createProvider(1).getPrices([USDC_REF, WBTC_REF], FIAT_CURRENCY.Usd)

    expect(requested).toHaveLength(2)
  })

  it('отправляет несколько адресов одним запросом при большем пакете', async () => {
    responder = () => ({ status: 200, body: {} })

    await createProvider(10).getPrices([USDC_REF, WBTC_REF], FIAT_CURRENCY.Usd)

    expect(requested).toHaveLength(1)
  })
})

describe('CoinGecko: неизвестное не подменяется нулём', () => {
  it('отсутствие записи означает неизвестный курс', async () => {
    /* Сервис отвечает пустым объектом на неизвестный контракт —
       без ошибки. Ноль здесь объявил бы актив ничего не стоящим. */
    responder = () => ({ status: 200, body: {} })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.has(priceRefKey(USDC_REF))).toBe(false)
  })

  it('нулевая и отрицательная цена отвергаются', () => {
    responder = () => ({ status: 200, body: { [USDC.toLowerCase()]: { usd: 0 } } })

    return createProvider()
      .getPrices([USDC_REF], FIAT_CURRENCY.Usd)
      .then((result) => {
        expect(result.has(priceRefKey(USDC_REF))).toBe(false)
      })
  })

  it('отсутствие суточного изменения не подменяется нулём', async () => {
    responder = () => ({ status: 200, body: { [USDC.toLowerCase()]: { usd: 1 } } })

    const result = await createProvider().getPrices([USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(USDC_REF))?.change24hPercent).toBeNull()
  })
})

describe('CoinGecko: отказы', () => {
  it('распознаёт ошибку в теле ответа при коде 200', async () => {
    /* Превышение предела адресов приходит именно так. Без проверки
       поля `error_code` такой ответ был бы разобран как «курсов нет». */
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

  it('сохраняет код ответа в сообщении об отказе', async () => {
    /* Ограничение частоты лечится ожиданием, а превышение предела
       адресов — настройкой: общее «источник недоступен» вместо кода
       не говорит, что делать. */
    responder = () => ({ status: 429, body: {} })

    await expect(createProvider().getPrices([NATIVE], FIAT_CURRENCY.Usd)).rejects.toThrow(/429/u)
  })

  it('частичный отказ не отменяет полученного', async () => {
    /* Курс эфира полезен и тогда, когда цену токена получить
       не удалось. */
    responder = (url) =>
      url.includes('token_price')
        ? { status: 500, body: {} }
        : { status: 200, body: { ethereum: { usd: 1864 } } }

    const result = await createProvider(1).getPrices([NATIVE, USDC_REF], FIAT_CURRENCY.Usd)

    expect(result.get(priceRefKey(NATIVE))?.price).toBe(1864)
    expect(result.has(priceRefKey(USDC_REF))).toBe(false)
  })
})
