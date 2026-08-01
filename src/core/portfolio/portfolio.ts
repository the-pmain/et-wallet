import { priceRefKey, type PriceMap } from '@/core/price'
import type { IToken } from '@/core/token'

import type { IPortfolioPosition, IPortfolioSummary } from './types'

/** Баланс токена на входе расчёта. */
export interface ITokenAmount {
  readonly token: IToken

  /** `null` означает «получить не удалось», а не ноль. */
  readonly balance: bigint | null
}

/**
 * Пустая сводка.
 *
 * Отдельная константа, а не сборка на месте: снимок состояния
 * сравнивается по ссылке, и новый объект на каждом вызове вызывал бы
 * лишнюю перерисовку.
 */
export const EMPTY_PORTFOLIO: IPortfolioSummary = {
  totalValue: 0,
  previousValue: null,
  change24hValue: null,
  change24hPercent: null,
  positions: [],
  positionsWithoutPrice: 0,
  positionsWithoutBalance: 0,
  oldestQuoteAt: null,
}

/**
 * Переводит баланс в целых единицах токена в число.
 *
 * ТОЧНОСТЬ ЗДЕСЬ ТЕРЯЕТСЯ, И ЭТО ДОПУСТИМО РОВНО ПОТОМУ, ЧТО РЕЗУЛЬТАТ
 * ИДЁТ ТОЛЬКО НА ЭКРАН. Суммы, которые подписываются, считаются целыми
 * числами в минимальных единицах и через это преобразование
 * не проходят никогда: оценка портфеля не участвует в формировании
 * ни одной транзакции.
 *
 * Деление выполняется в виде дроби из двух `bigint`, а не через
 * `Number(balance)`: у токена с восемнадцатью знаками целое значение
 * баланса выходит за пределы точного представления `number`, и прямое
 * преобразование исказило бы результат ещё до деления.
 */
export function toWholeUnits(balance: bigint, decimals: number): number {
  if (decimals === 0) {
    return Number(balance)
  }

  const divisor = 10n ** BigInt(decimals)
  const whole = balance / divisor
  const remainder = balance % divisor

  return Number(whole) + Number(remainder) / Number(divisor)
}

/**
 * Собирает сводку портфеля из балансов и курсов.
 *
 * ФУНКЦИЯ ЧИСТАЯ И НЕ ХОДИТ В СЕТЬ. Балансы и курсы получены раньше;
 * здесь только арифметика. Это позволяет проверить самую ответственную
 * часть — что именно попадает в сумму, а что из неё выпадает, — тестом
 * без единого сетевого вызова.
 */
export function buildPortfolio(
  amounts: readonly ITokenAmount[],
  prices: PriceMap,
): IPortfolioSummary {
  if (amounts.length === 0) {
    return EMPTY_PORTFOLIO
  }

  const positions: IPortfolioPosition[] = []

  let totalValue = 0
  let previousValue = 0
  let hasChangeData = false
  let positionsWithoutPrice = 0
  let positionsWithoutBalance = 0
  let oldestQuoteAt: number | null = null

  for (const { token, balance } of amounts) {
    const quote =
      prices.get(priceRefKey({ chainId: token.chainId, address: token.address })) ?? null

    if (balance === null) {
      positionsWithoutBalance += 1
      positions.push({ token, balance: null, quote, value: null, share: null })
      continue
    }

    if (quote === null) {
      positionsWithoutPrice += 1
      positions.push({ token, balance, quote: null, value: null, share: null })
      continue
    }

    const value = toWholeUnits(balance, token.decimals) * quote.price

    totalValue += value

    if (quote.change24hPercent === null) {
      /* Изменение неизвестно — вчерашняя цена принимается равной
         сегодняшней. Иначе позиция выпала бы из вчерашней суммы
         целиком, и изменение портфеля вышло бы завышенным на её
         полную стоимость. */
      previousValue += value
    } else {
      hasChangeData = true
      previousValue += value / (1 + quote.change24hPercent / 100)
    }

    if (oldestQuoteAt === null || quote.updatedAt < oldestQuoteAt) {
      oldestQuoteAt = quote.updatedAt
    }

    positions.push({ token, balance, quote, value, share: null })
  }

  const withShares = positions.map((position) => ({
    ...position,
    share: position.value === null || totalValue === 0 ? null : position.value / totalValue,
  }))

  return {
    totalValue,
    previousValue: hasChangeData ? previousValue : null,
    change24hValue: hasChangeData ? totalValue - previousValue : null,
    /* Деление на ноль даёт бесконечность, а не ошибку: портфель,
       вчера ничего не стоивший, не имеет процента изменения. */
    change24hPercent:
      hasChangeData && previousValue > 0
        ? ((totalValue - previousValue) / previousValue) * 100
        : null,
    positions: sortByValue(withShares),
    positionsWithoutPrice,
    positionsWithoutBalance,
    oldestQuoteAt,
  }
}

/**
 * Упорядочивает позиции по убыванию оценки.
 *
 * Позиции без оценки уходят в конец, а не исчезают: актив, курс
 * которого неизвестен, остаётся активом, и не показать его значило бы
 * скрыть от владельца часть его средств.
 */
function sortByValue(positions: readonly IPortfolioPosition[]): readonly IPortfolioPosition[] {
  return [...positions].sort((left, right) => {
    if (left.value === null && right.value === null) {
      return 0
    }

    if (left.value === null) {
      return 1
    }

    if (right.value === null) {
      return -1
    }

    return right.value - left.value
  })
}
