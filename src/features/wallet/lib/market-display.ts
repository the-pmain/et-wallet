/**
 * Показ рыночных величин.
 *
 * ЭТО НЕ `formatFiat`. Тот прячет сумму меньше цента за «< $0.01»,
 * потому что оценка портфеля такого порядка неотличима от нуля для
 * решения «отправлять или нет». Цена одной монеты — другое: $0.00000487
 * у SHIB обязана быть ценой, а не «меньше цента», иначе таблица врёт.
 */

const usdInteger = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Цена одной монеты. `null` — прочерк, не ноль. */
export function formatMarketPrice(value: number | null): string {
  if (value === null) {
    return '—'
  }

  const digits = fractionDigitsForPrice(Math.abs(value))

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Объём и капитализация без центов: в этом разряде цент ничего не значит. */
export function formatMarketUsd(value: number | null): string {
  if (value === null) {
    return '—'
  }

  return usdInteger.format(value)
}

/**
 * Изменение в процентах для таблицы.
 *
 * Один знак после запятой — как у источника на скрине. Знак числа
 * в строку не входит: направление несёт треугольник рядом, и плюс
 * рядом с ним читался бы как двойное утверждение.
 */
export function formatMarketChange(percent: number | null): string {
  if (percent === null) {
    return '—'
  }

  return `${Math.abs(percent).toFixed(1)}%`
}

/** Рост после округления до показанного разряда. */
export function isMarketChangeUp(percent: number): boolean {
  return Number(percent.toFixed(1)) >= 0
}

function fractionDigitsForPrice(value: number): number {
  if (value >= 1) {
    return 2
  }

  if (value >= 0.01) {
    return 4
  }

  if (value >= 0.0001) {
    return 6
  }

  return 8
}
