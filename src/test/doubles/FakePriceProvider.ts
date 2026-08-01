import {
  priceRefKey,
  type FiatCurrency,
  type IPriceProvider,
  type IPriceQuote,
  type IPriceRef,
  type PriceMap,
} from '@/core'

/** Настройки поведения источника курсов в конкретном тесте. */
export interface IFakePriceOptions {
  /**
   * Котировки по ключу `priceRefKey`.
   *
   * Отсутствие записи означает «курс неизвестен» — тот же случай,
   * что и пустой ответ настоящего сервиса на неизвестный контракт.
   */
  readonly quotes?: ReadonlyMap<string, IPriceQuote>

  /** Причина отказа. Источник бросает исключение вместо ответа. */
  readonly failure?: string
}

/**
 * Источник курсов-дублёр.
 *
 * Позволяет проверить главное свойство экрана портфеля: позиция
 * без курса не обнуляет оценку и не исчезает из списка.
 */
export class FakePriceProvider implements IPriceProvider {
  readonly id = 'fake'
  readonly name = 'Дублёр курсов'

  /** Сколько раз источник опрашивался. Показывает, что без согласия его не трогают. */
  callCount = 0

  #options: IFakePriceOptions = {}

  configure(options: IFakePriceOptions): void {
    this.#options = options
  }

  supports(): boolean {
    return true
  }

  getPrices(refs: readonly IPriceRef[], _currency: FiatCurrency): Promise<PriceMap> {
    this.callCount += 1

    if (this.#options.failure !== undefined) {
      return Promise.reject(new Error(this.#options.failure))
    }

    const source = this.#options.quotes ?? new Map<string, IPriceQuote>()
    const result = new Map<string, IPriceQuote>()

    for (const ref of refs) {
      const key = priceRefKey(ref)
      const quote = source.get(key)

      if (quote !== undefined) {
        result.set(key, quote)
      }
    }

    return Promise.resolve(result)
  }
}
