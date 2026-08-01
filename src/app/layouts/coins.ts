/** Параметры одной падающей монеты. */
export interface ICoin {
  /** Отступ слева в процентах ширины экрана. */
  readonly left: number

  /** Диаметр в пикселях. */
  readonly size: number

  /** Длительность падения в секундах. */
  readonly duration: number

  /** Задержка начала в секундах. Отрицательная сдвигает фазу назад. */
  readonly delay: number

  /** Горизонтальное смещение за всё падение, в пикселях. */
  readonly drift: number

  /** Непрозрачность. Мелкие монеты бледнее — это создаёт глубину. */
  readonly opacity: number

  /** Полный угол поворота за падение. */
  readonly spin: number
}

/**
 * Раскладка монет.
 *
 * ЗНАЧЕНИЯ ЗАДАНЫ ЯВНО, А НЕ СЛУЧАЙНЫ. Случайная раскладка менялась бы
 * при каждом рендере и иногда сбивалась в кучу у одного края. Здесь
 * положения распределены по ширине, а длительности взяты взаимно
 * непохожими: совпадающие периоды дали бы заметное падение «строем».
 *
 * ОТРИЦАТЕЛЬНЫЕ ЗАДЕРЖКИ СДВИГАЮТ ФАЗУ НАЗАД: монеты уже находятся
 * в пути в момент открытия экрана. Без этого первые секунды после
 * запуска фон был бы пустым, и эффект замечали бы только терпеливые.
 *
 * Тринадцать монет — компромисс: меньше выглядит случайной россыпью,
 * заметно больше даёт ощущение снегопада и начинает отвлекать от текста.
 */
export const COINS: readonly ICoin[] = [
  { left: 4, size: 14, duration: 26, delay: -3, drift: 18, opacity: 0.22, spin: 260 },
  { left: 12, size: 22, duration: 19, delay: -11, drift: -24, opacity: 0.34, spin: -320 },
  { left: 19, size: 10, duration: 31, delay: -7, drift: 12, opacity: 0.16, spin: 180 },
  { left: 27, size: 18, duration: 23, delay: -17, drift: -14, opacity: 0.28, spin: 300 },
  { left: 35, size: 12, duration: 29, delay: -1, drift: 22, opacity: 0.2, spin: -220 },
  { left: 43, size: 26, duration: 17, delay: -9, drift: -18, opacity: 0.38, spin: 360 },
  { left: 51, size: 11, duration: 33, delay: -21, drift: 16, opacity: 0.17, spin: -260 },
  { left: 59, size: 20, duration: 21, delay: -5, drift: -20, opacity: 0.31, spin: 280 },
  { left: 67, size: 13, duration: 27, delay: -14, drift: 14, opacity: 0.21, spin: -300 },
  { left: 75, size: 24, duration: 18, delay: -23, drift: -16, opacity: 0.36, spin: 340 },
  { left: 83, size: 10, duration: 35, delay: -6, drift: 20, opacity: 0.15, spin: 200 },
  { left: 90, size: 17, duration: 24, delay: -13, drift: -12, opacity: 0.27, spin: -280 },
  { left: 96, size: 12, duration: 30, delay: -19, drift: 10, opacity: 0.19, spin: 240 },
]
