import { describe, expect, it } from 'vitest'

import { PRICE_QUOTE_TTL_MS } from '@/core'

import {
  MAX_PRICE_REFRESH_INTERVAL_MS,
  PRICE_REFRESH_INTERVAL_MS,
  nextPriceRefreshDelay,
} from './price-refresh'

describe('nextPriceRefreshDelay: отказы разводят опросы, а не прекращают их', () => {
  it('без отказов держит обычный промежуток', () => {
    expect(nextPriceRefreshDelay(0)).toBe(PRICE_REFRESH_INTERVAL_MS)
  })

  it('удваивает промежуток на каждый отказ подряд', () => {
    /* Бесплатный доступ отвечает «429» на превышение частоты.
       Продолжать с прежним шагом — верный способ не получить курсов
       до конца сессии. */
    expect(nextPriceRefreshDelay(1)).toBe(2 * PRICE_REFRESH_INTERVAL_MS)
    expect(nextPriceRefreshDelay(2)).toBe(4 * PRICE_REFRESH_INTERVAL_MS)
    expect(nextPriceRefreshDelay(3)).toBe(8 * PRICE_REFRESH_INTERVAL_MS)
  })

  it('не растягивает промежуток дальше предела', () => {
    /* Иначе после часа неудач кошелёк ждал бы сутки: отказ бывает
       разовым, а замерший навсегда курс выглядит исправным. */
    expect(nextPriceRefreshDelay(10)).toBe(MAX_PRICE_REFRESH_INTERVAL_MS)
    expect(nextPriceRefreshDelay(1000)).toBe(MAX_PRICE_REFRESH_INTERVAL_MS)
  })

  it('отрицательное число отказов равносильно их отсутствию', () => {
    expect(nextPriceRefreshDelay(-1)).toBe(PRICE_REFRESH_INTERVAL_MS)
  })

  it('промежуток опроса дольше срока годности котировки', () => {
    /* СВЯЗЬ ДВУХ КОНСТАНТ, А НЕ СОВПАДЕНИЕ. Будь срок годности равен
       промежутку, опрос заставал бы котировку ровно на границе,
       запрос уходил бы через раз, и обновление шло бы вдвое реже
       обещанного. Тест держит это соотношение сам, сверяя обе
       константы: поднимут срок годности до минуты — станет красно. */
    expect(PRICE_REFRESH_INTERVAL_MS).toBeGreaterThan(PRICE_QUOTE_TTL_MS)
  })
})
