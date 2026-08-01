import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * Начиная со скольких записей включается виртуализация.
 *
 * До этого предела список рисуется целиком, и это не компромисс,
 * а сознательное решение: у полного списка работает поиск браузера,
 * печать и выделение мышью, а выигрыш от виртуализации на трёх десятках
 * строк неизмерим. Виртуализация нужна там, где обычный список начинает
 * стоить кадров, — и только там.
 */
const DEFAULT_THRESHOLD = 50

/**
 * Сколько строк рисуется за пределами видимой области.
 *
 * Без запаса быстрая прокрутка показывает пустоту: браузер успевает
 * отрисовать кадр раньше, чем обработчик прокрутки пересчитает окно.
 */
const DEFAULT_OVERSCAN = 6

/**
 * Высота видимой области, когда измерить её нельзя.
 *
 * Такое бывает при первой отрисовке до подключения к документу и в среде
 * без разметки. Ноль здесь означал бы пустой список вместо содержимого,
 * поэтому берётся заведомо достаточное значение: лишние строки
 * отрисуются и исчезнут после первого измерения, а пустой экран
 * пользователь успеет заметить.
 */
const FALLBACK_VIEWPORT_HEIGHT = 900

interface VirtualListProps<TItem> {
  readonly items: readonly TItem[]

  /**
   * Высота одной строки в пикселях.
   *
   * ОБЯЗАНА СОВПАДАТЬ С ФАКТИЧЕСКОЙ. Расхождение не теряет данных,
   * но смещает окно: строки начинают «уезжать» при прокрутке. Поэтому
   * строка должна иметь фиксированную высоту, а не зависеть от длины
   * содержимого.
   */
  readonly itemHeight: number

  readonly renderItem: (item: TItem, index: number) => ReactNode
  readonly getKey: (item: TItem, index: number) => string

  /** Со скольких записей включать виртуализацию. */
  readonly threshold?: number

  /** Запас строк за пределами видимой области. */
  readonly overscan?: number

  readonly className?: string
  readonly itemClassName?: string
}

/**
 * Список, рисующий только видимые строки.
 *
 * ЗАЧЕМ. История переводов активного адреса доходит до сотен записей.
 * Каждая строка — это девять узлов DOM, два значка и разбор суммы;
 * пятьсот таких строк заметно тормозят прокрутку на слабом устройстве
 * и удерживают память под узлы, которых никто не видит.
 *
 * ЧТО ВИРТУАЛИЗАЦИЯ ЛОМАЕТ, И ПОЧЕМУ ЗДЕСЬ ЭТО ДОПУСТИМО. Строк
 * не существует в документе, пока они не попали в видимую область:
 * поиск браузера (Ctrl+F) их не найдёт, печать выведет только
 * видимое. Это настоящая потеря, и она допустима ровно потому, что
 * на экране истории есть собственный отбор — по направлению, виду
 * актива и адресу контрагента. Списка без своего поиска
 * виртуализировать нельзя.
 *
 * ЭКРАННЫЙ ДИКТОР ПОЛУЧАЕТ ПОЛНЫЙ РАЗМЕР. `aria-setsize` и
 * `aria-posinset` сообщают, сколько всего записей и какая по счёту
 * читается сейчас: без них диктор объявил бы «список из двенадцати
 * элементов» там, где их пятьсот.
 *
 * ПРОКРУТКА — ОКОННАЯ, А НЕ СОБСТВЕННАЯ. Внутренняя область прокрутки
 * дала бы вторую полосу внутри первой; в окне шириной 360 пикселей это
 * означает, что пользователь прокручивает не то, что собирался.
 */
export function VirtualList<TItem>({
  items,
  itemHeight,
  renderItem,
  getKey,
  threshold = DEFAULT_THRESHOLD,
  overscan = DEFAULT_OVERSCAN,
  className,
  itemClassName,
}: VirtualListProps<TItem>) {
  const containerRef = useRef<HTMLUListElement>(null)
  const [range, setRange] = useState<IRange>({ start: 0, end: items.length })

  const isVirtual = items.length > threshold

  /**
   * Пересчитывает видимое окно по положению списка в окне просмотра.
   *
   * Считается от `getBoundingClientRect`, а не от накопленной прокрутки:
   * список лежит под шапкой и предупреждениями переменной высоты,
   * и вычитать их вручную значило бы дублировать вёрстку в коде.
   */
  const measure = useCallback(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    const viewportHeight = globalThis.innerHeight || FALLBACK_VIEWPORT_HEIGHT
    const top = container.getBoundingClientRect().top

    /* Сколько строк уже ушло вверх за границу окна просмотра. */
    const hidden = Math.max(0, Math.floor(-top / itemHeight))
    const visibleCount = Math.ceil(viewportHeight / itemHeight)

    const start = Math.max(0, hidden - overscan)
    const end = Math.min(items.length, hidden + visibleCount + overscan)

    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    )
  }, [itemHeight, items.length, overscan])

  useEffect(() => {
    if (!isVirtual) {
      return
    }

    measure()

    /* Обработчики пассивные: они ничего не отменяют, а браузер благодаря
       этому не ждёт их завершения перед прокруткой. */
    const options: AddEventListenerOptions = { passive: true }

    globalThis.addEventListener('scroll', measure, options)
    globalThis.addEventListener('resize', measure, options)

    return () => {
      globalThis.removeEventListener('scroll', measure)
      globalThis.removeEventListener('resize', measure)
    }
  }, [isVirtual, measure])

  if (!isVirtual) {
    return (
      <ul ref={containerRef} className={className}>
        {items.map((item, index) => (
          <li key={getKey(item, index)} className={itemClassName}>
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    )
  }

  const visible = items.slice(range.start, range.end)
  const paddingTop = range.start * itemHeight
  const paddingBottom = Math.max(0, (items.length - range.end) * itemHeight)

  return (
    <ul
      ref={containerRef}
      className={className}
      /* Отступы вместо распорок-элементов: пустой `li` попал бы
         в подсчёт элементов списка у экранного диктора. */
      style={{ paddingTop, paddingBottom }}
    >
      {visible.map((item, offset) => {
        const index = range.start + offset

        return (
          <li
            key={getKey(item, index)}
            className={cn(itemClassName, 'box-border')}
            style={{ height: itemHeight }}
            aria-setsize={items.length}
            aria-posinset={index + 1}
          >
            {renderItem(item, index)}
          </li>
        )
      })}
    </ul>
  )
}

/** Границы видимого окна. Конец не включается. */
interface IRange {
  readonly start: number
  readonly end: number
}
