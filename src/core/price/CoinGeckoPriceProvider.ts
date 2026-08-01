import { SystemClock, type IClock } from '@/core/platform'
import type { ChainId, Timestamp } from '@/core/types'

import { findCoinGeckoPlatform } from './coingecko-platforms'
import type { IPriceProvider } from './contracts'
import {
  priceRefKey,
  type FiatCurrency,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from './types'

const PROVIDER_ID = 'coingecko'
const PROVIDER_NAME = 'CoinGecko'

const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3'

/**
 * Сколько адресов контрактов уходит в один запрос.
 *
 * ЕДИНИЦА — НЕ ОСТОРОЖНОСТЬ, А ИЗМЕРЕННОЕ ОГРАНИЧЕНИЕ. Бесплатный
 * публичный доступ отвечает отказом `10012` на запрос с двумя адресами:
 * «Number of contract addresses in the request exceeds the allowed limit
 * of 1 contract address». Пакет больше единицы доступен только
 * с ключом, поэтому размер задаётся настройкой, а не константой.
 */
const DEFAULT_CONTRACT_BATCH_SIZE = 1

/** Предел ожидания ответа. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Настройки источника. */
export interface ICoinGeckoOptions {
  /** Базовый адрес. Заменяется в тестах и при использовании платного узла. */
  readonly baseUrl?: string

  /**
   * Ключ демонстрационного либо платного доступа.
   *
   * Без ключа сервис отвечает на один адрес контракта за запрос
   * и жёстко ограничивает частоту.
   */
  readonly apiKey?: string

  /** Сколько адресов контрактов отправлять одним запросом. */
  readonly contractBatchSize?: number

  readonly timeoutMs?: number

  /** Замена `fetch` для тестов. */
  readonly fetchImpl?: typeof fetch

  /**
   * Источник времени.
   *
   * Нужен для ответов, в которых сервис не указал момент котировки:
   * подставляется текущее время, и оно обязано быть управляемым
   * в тесте, а не браться из системных часов напрямую.
   */
  readonly clock?: IClock
}

/**
 * Курсы из CoinGecko.
 *
 * ЧТО СЕРВИС УЗНАЁТ О ПОЛЬЗОВАТЕЛЕ. Адреса контрактов, курсы которых
 * запрошены, идентификатор сети и IP-адрес. Этого достаточно, чтобы
 * узнать состав портфеля, но НЕ ДОСТАТОЧНО, чтобы связать его
 * с конкретным адресом кошелька: адрес владельца сюда не передаётся
 * ни в каком виде и передан быть не может — метод его не принимает.
 *
 * Именно поэтому источник включается только явным согласием
 * пользователя, а не по умолчанию.
 *
 * ЗАПРОСЫ РАЗДЕЛЕНЫ НА ДВА ВИДА. Нативная валюта запрашивается
 * по идентификатору монеты (`simple/price`), токены — по адресу
 * контракта (`simple/token_price/{платформа}`). Это разные конечные
 * точки с разными ограничениями, и объединить их нельзя.
 */
export class CoinGeckoPriceProvider implements IPriceProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  readonly #baseUrl: string
  readonly #apiKey: string | null
  readonly #contractBatchSize: number
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch
  readonly #clock: IClock

  constructor(options: ICoinGeckoOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#apiKey = options.apiKey ?? null
    this.#contractBatchSize = options.contractBatchSize ?? DEFAULT_CONTRACT_BATCH_SIZE
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.#clock = options.clock ?? new SystemClock()
  }

  supports(chainId: ChainId): boolean {
    return findCoinGeckoPlatform(chainId) !== null
  }

  async getPrices(refs: readonly IPriceRef[], currency: FiatCurrency): Promise<PriceMap> {
    const supported = refs.filter((ref) => this.supports(ref.chainId))

    if (supported.length === 0) {
      return new Map()
    }

    const quotes = new Map<string, IPriceQuote>()

    /* Отказ по одной группе не отменяет остальных: курс эфира полезен
       и тогда, когда цену одного токена получить не удалось. Но если
       не удалось ничего, наружу уходит исключение — пустой ответ
       и недоступность сервиса читаются по-разному. */
    let failures = 0
    let attempts = 0

    /* Причина первого отказа сохраняется. Общее «источник недоступен»
       вместо неё скрыло бы единственное, что говорит, как быть дальше:
       превышение предела адресов лечится настройкой, а ограничение
       частоты — ожиданием, и это разные действия. */
    let firstError: Error | null = null

    for (const [chainKey, group] of groupByChain(supported)) {
      const platform = findCoinGeckoPlatform(group[0]?.chainId ?? (chainKey as unknown as ChainId))

      if (platform === null) {
        continue
      }

      const natives = group.filter((ref) => ref.address === null)
      const tokens = group.filter((ref) => ref.address !== null)

      if (natives.length > 0) {
        attempts += 1

        try {
          await this.#loadNative(natives, platform.nativeCoinId, currency, quotes)
        } catch (error) {
          failures += 1
          firstError ??= toError(error)
        }
      }

      for (const batch of chunk(tokens, this.#contractBatchSize)) {
        attempts += 1

        try {
          await this.#loadTokens(batch, platform.platformId, currency, quotes)
        } catch (error) {
          failures += 1
          firstError ??= toError(error)
        }
      }
    }

    if (attempts > 0 && failures === attempts && firstError !== null) {
      throw new Error(`Курсы получить не удалось: ${firstError.message}`, { cause: firstError })
    }

    return quotes
  }

  /** Курс нативной валюты запрашивается по идентификатору монеты. */
  async #loadNative(
    refs: readonly IPriceRef[],
    coinId: string,
    currency: FiatCurrency,
    into: Map<string, IPriceQuote>,
  ): Promise<void> {
    const url = new URL(`${this.#baseUrl}/simple/price`)

    url.searchParams.set('ids', coinId)
    url.searchParams.set('vs_currencies', currency)
    url.searchParams.set('include_24hr_change', 'true')
    url.searchParams.set('include_last_updated_at', 'true')

    const payload = await this.#request(url)
    const quote = readQuote(payload[coinId], currency, this.#clock)

    if (quote === null) {
      return
    }

    for (const ref of refs) {
      into.set(priceRefKey(ref), quote)
    }
  }

  /** Курсы токенов запрашиваются по адресам контрактов. */
  async #loadTokens(
    refs: readonly IPriceRef[],
    platformId: string,
    currency: FiatCurrency,
    into: Map<string, IPriceQuote>,
  ): Promise<void> {
    if (refs.length === 0) {
      return
    }

    const url = new URL(`${this.#baseUrl}/simple/token_price/${platformId}`)

    url.searchParams.set(
      'contract_addresses',
      refs.map((ref) => (ref.address ?? '').toLowerCase()).join(','),
    )
    url.searchParams.set('vs_currencies', currency)
    url.searchParams.set('include_24hr_change', 'true')
    url.searchParams.set('include_last_updated_at', 'true')

    const payload = await this.#request(url)

    for (const ref of refs) {
      /* Ответ приходит с адресами в нижнем регистре независимо от того,
         в каком виде они были отправлены. */
      const quote = readQuote(payload[(ref.address ?? '').toLowerCase()], currency, this.#clock)

      if (quote !== null) {
        into.set(priceRefKey(ref), quote)
      }
    }
  }

  /**
   * Выполняет запрос.
   *
   * ОШИБКА В ТЕЛЕ ОТВЕТА ПРИ КОДЕ 200 — ОБЫЧНОЕ ПОВЕДЕНИЕ ЭТОГО СЕРВИСА.
   * Превышение предела адресов приходит именно так, и без проверки
   * поля `error_code` такой ответ был бы разобран как «курсов нет».
   */
  async #request(url: URL): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: 'application/json' }

    if (this.#apiKey !== null) {
      headers['x-cg-demo-api-key'] = this.#apiKey
    }

    const response = await this.#fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
      /* Ни cookie, ни заголовков авторизации: браузер не должен
         подставлять к запросу ничего, о чём пользователь не знает. */
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })

    if (!response.ok) {
      throw new Error(`Источник курсов ответил ${String(response.status)}.`)
    }

    const payload: unknown = await response.json()

    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Источник курсов вернул неожиданный ответ.')
    }

    const record = payload as Record<string, unknown>

    if (record['error_code'] !== undefined) {
      throw new Error(readErrorMessage(record))
    }

    return record
  }
}

/** Приводит пойманное значение к ошибке, не теряя сообщения. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** Достаёт понятное сообщение из ответа об ошибке. */
function readErrorMessage(payload: Record<string, unknown>): string {
  const status = payload['status']

  if (typeof status === 'object' && status !== null) {
    const message = (status as Record<string, unknown>)['error_message']

    if (typeof message === 'string') {
      return message
    }
  }

  return 'Источник курсов отказал в запросе.'
}

/**
 * Разбирает одну котировку.
 *
 * Возвращает `null`, если цены нет: запись без цены означает, что курс
 * неизвестен. Подставить ноль значило бы объявить актив ничего
 * не стоящим.
 */
function readQuote(entry: unknown, currency: FiatCurrency, clock: IClock): IPriceQuote | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const record = entry as Record<string, unknown>
  const price = record[currency]

  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null
  }

  const change = record[`${currency}_24h_change`]
  const updatedAt = record['last_updated_at']

  return {
    price,
    change24hPercent: typeof change === 'number' && Number.isFinite(change) ? change : null,
    /* Сервис отдаёт момент в секундах; внутренний тип — миллисекунды. */
    updatedAt: typeof updatedAt === 'number' ? ((updatedAt * 1000) as Timestamp) : clock.now(),
  }
}

/** Разбивает запрос по сетям: у каждой свой идентификатор платформы. */
function groupByChain(refs: readonly IPriceRef[]): ReadonlyMap<string, readonly IPriceRef[]> {
  const groups = new Map<string, IPriceRef[]>()

  for (const ref of refs) {
    const key = ref.chainId.toString()
    const bucket = groups.get(key)

    if (bucket === undefined) {
      groups.set(key, [ref])
    } else {
      bucket.push(ref)
    }
  }

  return groups
}

/** Режет список на части заданного размера. */
function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const parts: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size))
  }

  return parts
}
