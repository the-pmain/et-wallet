import type { ChainId } from '@/core/types'

import type { IPriceProvider } from './contracts'
import type { FiatCurrency, IPriceRef, PriceMap } from './types'

/**
 * Источник, который курсов не знает.
 *
 * ЭТО НЕ ЗАГЛУШКА ДЛЯ ТЕСТОВ, А БОЕВОЕ ПОВЕДЕНИЕ ПО УМОЛЧАНИЮ.
 * Пока пользователь не согласился на обращение к стороннему сервису,
 * кошелёк курсов не запрашивает — и это состояние обязано быть
 * выражено объектом, а не отсутствием объекта: `null` вместо источника
 * заставил бы каждое место вызова помнить о проверке.
 *
 * Пустой словарь означает «курсы неизвестны», и интерфейс показывает
 * портфель без стоимости. Он не означает «активы ничего не стоят».
 */
export class NullPriceProvider implements IPriceProvider {
  readonly id = 'none'
  readonly name = 'Источник курсов не подключён'

  supports(_chainId: ChainId): boolean {
    return false
  }

  getPrices(_refs: readonly IPriceRef[], _currency: FiatCurrency): Promise<PriceMap> {
    return Promise.resolve(new Map())
  }
}
