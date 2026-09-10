import { cn } from '@/shared/lib/utils'

/** Один сектор диаграммы. */
export interface IDonutSlice {
  /** Устойчивый ключ. */
  readonly id: string

  /** Подпись для вспомогательных технологий. */
  readonly label: string

  /** Доля от нуля до единицы. */
  readonly share: number

  /** Цвет сектора в виде значения CSS. */
  readonly color: string
}

export interface DonutChartProps {
  readonly slices: readonly IDonutSlice[]

  /** Значение в центре кольца. */
  readonly caption?: string

  /** Подпись под значением. */
  readonly captionHint?: string

  readonly className?: string
}

/** Дуга, готовая к отрисовке. */
interface IArc {
  readonly id: string
  readonly color: string

  /** Длина дуги вдоль окружности. */
  readonly length: number

  /** Смещение начала дуги от нуля. */
  readonly offset: number
}

/** Радиус окружности в пользовательских единицах SVG. */
const RADIUS = 42

/** Толщина кольца. */
const STROKE_WIDTH = 14

const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Доля меньше этой не рисуется: сектор в доли пикселя неразличим. */
const MIN_VISIBLE_SHARE = 0.005

/**
 * Кольцевая диаграмма долей.
 *
 * ПОЧЕМУ СВОЙ SVG, А НЕ БИБЛИОТЕКА ГРАФИКОВ. Готовые библиотеки весят
 * сотни килобайт, а бандл кошелька и так вырос до предела, при котором
 * экраны входа тянут за собой весь сетевой слой. Кольцо из дуг —
 * это окружность с прерывистой обводкой и полтора десятка строк
 * арифметики.
 *
 * ДИАГРАММА НЕ ЯВЛЯЕТСЯ ЕДИНСТВЕННЫМ СПОСОБОМ УЗНАТЬ ДОЛИ. Она помечена
 * `role="img"` с текстовым описанием, а рядом всегда стоит список
 * с числами: цвет как единственный признак недоступен людям
 * с нарушением цветовосприятия, а разница между 18 % и 22 % на кольце
 * неразличима вообще ни для кого.
 */
export function DonutChart({ slices, caption, captionHint, className }: DonutChartProps) {
  const visible = slices.filter((slice) => slice.share >= MIN_VISIBLE_SHARE)

  const description = visible
    .map((slice) => `${slice.label} ${(slice.share * 100).toFixed(1)} percent`)
    .join(', ')

  /* Смещения считаются заранее, а не накоплением по ходу разметки:
     переменная, изменяемая внутри рендера, даёт разный результат при
     повторном проходе — React вправе выполнить его дважды. */
  const arcs = toArcs(visible)

  return (
    <div className={cn('relative aspect-square w-full max-w-56', className)}>
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        role="img"
        aria-label={description}
      >
        {/* Фоновое кольцо: без него портфель из одного актива выглядел бы
            как отсутствие диаграммы. */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-muted"
        />

        {arcs.map((arc) => (
          <circle
            key={arc.id}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>

      {caption === undefined ? null : (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
          <span className="text-lg font-semibold tabular-nums">{caption}</span>
          {captionHint === undefined ? null : (
            <span className="text-xs text-muted-foreground">{captionHint}</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Переводит доли в дуги с накопленным смещением. */
function toArcs(slices: readonly IDonutSlice[]): readonly IArc[] {
  const arcs: IArc[] = []

  let offset = 0

  for (const slice of slices) {
    const length = slice.share * CIRCUMFERENCE

    arcs.push({ id: slice.id, color: slice.color, length, offset })
    offset += length
  }

  return arcs
}
