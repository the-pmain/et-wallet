import type { IClock, ILogger } from '@/core/platform'

import type { IPriceProvider, IPriceService } from './contracts'
import {
  priceRefKey,
  FIAT_CURRENCY,
  type FiatCurrency,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from './types'

const SERVICE_NAME = 'PriceService'

/**
 * Сколько котировка считается свежей.
 *
 * Минута — компромисс между точностью показа и частотой обращений
 * к стороннему сервису. Каждое обращение раскрывает состав портфеля
 * и тратит жёсткий лимит бесплатного доступа, поэтому чаще опрашивать
 * не только бесполезно, но и вредно.
 *
 * Курс запрашивается по действию: открытие кошелька, обновление,
 * смена сети или аккаунта. Фонового опроса нет — он был сделан
 * и снят, см. запись A-171 в TECH_DEBT. Поэтому котировка на экране
 * может быть заметно старше минуты, и рядом с оценкой показано время,
 * на которое она действительна.
 */
const DEFAULT_TTL_MS = 60_000

/** Зависимости сервиса. */
export interface IPriceServiceDependencies {
  readonly provider: IPriceProvider
  readonly clock: IClock
  readonly logger: ILogger

  readonly currency?: FiatCurrency
  readonly ttlMs?: number
}

/** Запись кэша. */
interface ICacheEntry {
  readonly quote: IPriceQuote

  /** Момент получения, а не момент котировки: устаревание считается от него. */
  readonly fetchedAt: number
}

/**
 * Курсы с кэшированием.
 *
 * ЧАСТИЧНЫЙ РЕЗУЛЬТАТ — НОРМАЛЬНЫЙ РЕЗУЛЬТАТ. Отсутствие курса
 * в ответе означает «неизвестен» и обязано отличаться от нуля:
 * актив без курса не должен обнулять оценку портфеля, он должен
 * из неё выпасть с явной пометкой.
 *
 * ОТКАЗ ИСТОЧНИКА НЕ ВЫБРАСЫВАЕТСЯ НАРУЖУ. Портфель без стоимости
 * лучше пустого экрана: балансы известны и без курсов. Причина отказа
 * записывается в журнал и доступна через `lastError` — интерфейс
 * обязан сказать, что стоимость не получена, а не показать её нулём.
 */
export class PriceService implements IPriceService {
  readonly #provider: IPriceProvider
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #currency: FiatCurrency
  readonly #ttlMs: number

  readonly #cache = new Map<string, ICacheEntry>()

  /** Причина последнего отказа источника. `null`, если отказа не было. */
  #lastError: string | null = null

  constructor(dependencies: IPriceServiceDependencies) {
    this.#provider = dependencies.provider
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#currency = dependencies.currency ?? FIAT_CURRENCY.Usd
    this.#ttlMs = dependencies.ttlMs ?? DEFAULT_TTL_MS
  }

  /** Имя источника. Пользователь вправе знать, кому уходят запросы. */
  get providerName(): string {
    return this.#provider.name
  }

  get lastError(): string | null {
    return this.#lastError
  }

  async getPrices(refs: readonly IPriceRef[]): Promise<PriceMap> {
    const now = this.#clock.now()
    const result = new Map<string, IPriceQuote>()
    const missing: IPriceRef[] = []

    for (const ref of refs) {
      const key = priceRefKey(ref)
      const cached = this.#cache.get(key)

      if (cached !== undefined && now - cached.fetchedAt < this.#ttlMs) {
        result.set(key, cached.quote)
      } else {
        missing.push(ref)
      }
    }

    if (missing.length === 0) {
      return result
    }

    try {
      const fresh = await this.#provider.getPrices(missing, this.#currency)

      for (const [key, quote] of fresh) {
        this.#cache.set(key, { quote, fetchedAt: now })
        result.set(key, quote)
      }

      this.#lastError = null
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error)

      this.#logger.warn('Prices could not be fetched', { reason: this.#lastError })

      /* Устаревшие котировки лучше отсутствующих: стоимость минутной
         давности показывает порядок величины, а пустой экран
         не показывает ничего. Возраст виден по `updatedAt`. */
      for (const ref of missing) {
        const key = priceRefKey(ref)
        const stale = this.#cache.get(key)

        if (stale !== undefined) {
          result.set(key, stale.quote)
        }
      }
    }

    return result
  }

  invalidate(): void {
    this.#cache.clear()
  }
}
