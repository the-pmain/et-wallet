import type { IPortfolioPosition } from '@/core'

/**
 * Показ денежных величин и долей.
 *
 * ВСЕ ВЕЛИЧИНЫ ЗДЕСЬ — ОЦЕНОЧНЫЕ. Они получены умножением баланса
 * на курс стороннего сервиса и годятся только для представления
 * о порядке. Ни одна из них не участвует в формировании транзакции:
 * суммы, которые подписываются, считаются целыми числами
 * в минимальных единицах.
 */

/** Разряды дробной части в денежной величине. */
const FIAT_FRACTION_DIGITS = 2

/**
 * Порог, ниже которого сумма показывается как «меньше цента».
 *
 * Округление до нуля показало бы «0,00 $» у позиции, которая чего-то
 * стоит: пользователь прочитал бы это как «ничего не стоит».
 */
const MIN_DISPLAYED_FIAT = 0.01

/*
  ЯЗЫК ЧИСЛА СЛЕДУЕТ ЗА ЯЗЫКОМ ИНТЕРФЕЙСА. Здесь стояло `ru-RU`, и
  оценка выводилась как «1 234,56 $» посреди полностью английского
  экрана: запятая в роли десятичного разделителя, а знак валюты —
  после числа. Для читающего по-английски это либо другое число,
  либо опечатка.

  Правка внесена вместе с показом оценки на главном экране: там
  расхождение перестаёт быть частностью экрана портфеля и попадает
  на первое, что видит владелец. Разряды и знак теперь размечает
  тот же язык, что объявлен у документа, — `$1,234.56`.
*/
const fiatFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: FIAT_FRACTION_DIGITS,
  maximumFractionDigits: FIAT_FRACTION_DIGITS,
})

/**
 * Денежная величина.
 *
 * `null` показывается прочерком, а не нулём: «стоимость неизвестна»
 * и «стоит ноль» — разные утверждения, и второе, показанное вместо
 * первого, читается владельцем как пропажа.
 */
export function formatFiat(value: number | null): string {
  if (value === null) {
    return '—'
  }

  if (value > 0 && value < MIN_DISPLAYED_FIAT) {
    return `< ${fiatFormatter.format(MIN_DISPLAYED_FIAT)}`
  }

  return fiatFormatter.format(value)
}

/** Доля в процентах. `null` — прочерк. */
export function formatShare(share: number | null): string {
  return share === null ? '—' : `${(share * 100).toFixed(1)} %`
}

/** Изменение в процентах со знаком. `null` — прочерк. */
export function formatChangePercent(percent: number | null): string {
  if (percent === null) {
    return '—'
  }

  const sign = percent > 0 ? '+' : ''

  return `${sign}${percent.toFixed(2)} %`
}

/**
 * Цвета секторов диаграммы.
 *
 * Берутся из токенов оформления, а не задаются шестнадцатеричными
 * значениями: иначе диаграмма не следовала бы за сменой темы
 * и на тёмном фоне часть секторов стала бы неразличимой.
 *
 * Восемь оттенков: больше человек всё равно не различает на кольце,
 * а лишние позиции сводятся в «прочее».
 */
const SLICE_COLORS: readonly string[] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
]

/** Цвет сектора по его порядковому номеру. */
export function sliceColor(index: number): string {
  return SLICE_COLORS[index % SLICE_COLORS.length] ?? SLICE_COLORS[0] ?? 'var(--primary)'
}

/** Устойчивый ключ позиции: пара «сеть + адрес» однозначна. */
export function positionKey(position: IPortfolioPosition): string {
  const { chainId, address } = position.token

  return `${chainId.toString()}:${address ?? 'native'}`
}
