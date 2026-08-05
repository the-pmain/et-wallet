import type { ComponentType } from 'react'

import { cn } from '@/shared/lib/utils'

/** Один вариант выбора. */
export interface ISegmentedOption<TValue extends string> {
  readonly value: TValue
  readonly label: string

  /**
   * Значок рядом с надписью.
   *
   * Необязателен: у отбора истории значка нет, у выбора темы есть.
   * Значок дополняет надпись, но не заменяет её — набор из одних
   * значков заставляет угадывать, а угадывать в кошельке нечего.
   */
  readonly icon?: ComponentType<{ className?: string }> | undefined

  /**
   * Доступное имя, если видимой надписи для различения недостаточно.
   *
   * Нужно там, где короткая надпись повторяется в соседнем наборе:
   * две кнопки с именем «All» неразличимы для того, кто слушает
   * страницу, а не смотрит на неё.
   */
  readonly name?: string | undefined
}

export interface SegmentedControlProps<TValue extends string> {
  readonly options: readonly ISegmentedOption<TValue>[]
  readonly value: TValue
  readonly onChange: (value: TValue) => void

  /**
   * Видимая подпись набора.
   *
   * Обязательная, а не необязательная. Набор кнопок без имени
   * заставляет угадывать, чем он управляет, а угадывание в кошельке
   * оканчивается неверно выбранной скоростью или отбором.
   */
  readonly legend: string

  readonly className?: string | undefined
}

/**
 * Выбор одного значения из набора.
 *
 * ОБЩИЙ ПРИМИТИВ, А НЕ ПОВТОР В КАЖДОМ ЭКРАНЕ. Такой переключатель
 * появился независимо на отборе истории и на выборе скорости отправки,
 * и наборы уже начали расходиться в мелочах — разная высота, разный
 * вид выбранного. Одинаковые по смыслу органы управления, выглядящие
 * по-разному, читаются как разные по назначению.
 *
 * ВЫБРАННОЕ ОТМЕЧЕНО ТРЕМЯ ПРИЗНАКАМИ СРАЗУ: цветом, поднятием и
 * `aria-pressed`. Цвет как единственный признак недоступен людям
 * с нарушением цветовосприятия и не читается вспомогательными
 * технологиями.
 *
 * ВЫСОТА 44 ПИКСЕЛЯ — нижний предел прицеливания пальцем. И отбор,
 * и скорость отправки нажимают на телефоне не реже, чем мышью.
 */
export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  legend,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {legend}
      </legend>

      {/* Общая дорожка под всем набором. Без неё кнопки читаются как
          отдельные действия, а не как выбор одного значения из ряда. */}
      <div
        className="grid gap-1 rounded-xl bg-muted/60 p-1"
        style={{ gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const isSelected = option.value === value
          const Icon = option.icon

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              aria-label={option.name}
              onClick={() => {
                onChange(option.value)
              }}
              className={cn(
                /* Рамок нет: внутри дорожки они рисовали бы вторую
                   сетку поверх первой. */
                'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 truncate rounded-lg px-2 text-xs font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isSelected
                  ? 'bg-primary/15 text-primary-emphasis shadow-surface'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon === undefined ? null : <Icon className="size-4 shrink-0" />}
              <span className="truncate">{option.label}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
