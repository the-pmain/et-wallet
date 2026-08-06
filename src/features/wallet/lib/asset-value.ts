import {
  toWholeUnits,
  type Address,
  type ChainId,
  type IBalance,
  type IPortfolioSummary,
  type IPriceQuote,
} from '@/core'

/**
 * Оценка показанных величин в долларах.
 *
 * ВСЕ ВЕЛИЧИНЫ ЗДЕСЬ — ОЦЕНОЧНЫЕ И ИДУТ ТОЛЬКО НА ЭКРАН. Они получены
 * умножением баланса на курс стороннего сервиса. Ни одна из них
 * не участвует в формировании транзакции: суммы, которые подписываются,
 * считаются целыми числами в минимальных единицах.
 */

/**
 * Находит котировку актива в сводке портфеля.
 *
 * СЕТЬ СВЕРЯЕТСЯ. При переключении сети балансы и сводка обновляются
 * не одновременно, и есть промежуток, в котором сводка ещё от прежней
 * сети. Без сверки баланс в BNB оказался бы оценён по курсу эфира,
 * то есть завышен в сотни раз.
 *
 * `null` в адресе означает нативную валюту: контракта у неё нет
 * по устройству сети.
 */
export function findQuote(
  portfolio: IPortfolioSummary | null,
  chainId: ChainId | null,
  address: Address | null,
): IPriceQuote | null {
  if (portfolio === null || chainId === null) {
    return null
  }

  const position = portfolio.positions.find(
    ({ token }) => token.chainId === chainId && token.address === address,
  )

  return position?.quote ?? null
}

/**
 * Оценка количества по котировке.
 *
 * СЧИТАЕТСЯ ОТ ПОКАЗАННОГО КОЛИЧЕСТВА, А НЕ БЕРЁТСЯ ГОТОВОЙ ИЗ ПОЗИЦИИ.
 * В сводке портфеля у каждой позиции уже лежит `value`, и взять его
 * было бы короче. Но балансы обновляются отдельно от курсов: после
 * такого обновления готовая оценка описывала бы прежнее количество.
 * Рядом с числом стояла бы цена другого числа — и заметить это
 * неоткуда.
 *
 * Поэтому из сводки берётся только курс, а умножается на него ровно
 * та величина, которая выведена на экран. Курс при этом может быть
 * устаревшим — это свойство любых курсов, оно оговорено словом
 * «примерно» и показано временем котировки. Несовпадение количества
 * с его ценой свойством не является.
 *
 * `null` — оценки нет: неизвестно количество либо курс. Ноль сюда
 * не подставляется никогда: «стоимость неизвестна» и «стоит ноль» —
 * разные утверждения, и второе, показанное вместо первого, читается
 * владельцем как пропажа.
 */
export function estimateValue(
  balance: bigint | null,
  decimals: number,
  quote: IPriceQuote | null,
): number | null {
  if (balance === null || quote === null) {
    return null
  }

  return toWholeUnits(balance, decimals) * quote.price
}

/**
 * Оценка показанного баланса нативной валюты.
 *
 * Отдельная функция, потому что баланс нативной валюты приходит
 * не из списка токенов, а собственным полем снимка — со своей сетью
 * и своим числом знаков.
 */
export function estimateNativeValue(
  balance: IBalance | null,
  portfolio: IPortfolioSummary | null,
): number | null {
  if (balance === null) {
    return null
  }

  return estimateValue(balance.raw, balance.decimals, findQuote(portfolio, balance.chainId, null))
}
