import { cn } from '@/shared/lib/utils'

interface AccountAvatarProps {
  readonly address: string
  readonly className?: string
}

/** Сколько ячеек по стороне. Нечётное число даёт центральную ось симметрии. */
const GRID = 5

/** Половина ширины, отражаемая зеркально. */
const HALF = Math.ceil(GRID / 2)

/**
 * Визуальный отпечаток адреса.
 *
 * ЭТО ЗАЩИТНАЯ ФУНКЦИЯ, А НЕ УКРАШЕНИЕ. Пользователь опознаёт адрес
 * по четырём-шести символам, а подобрать адрес с нужными крайними
 * символами вычислительно дёшево. Картинка зависит от всех сорока
 * символов сразу: подменённый адрес меняет её целиком, и разница
 * заметна боковым зрением, без вчитывания.
 *
 * ОТПЕЧАТОК НЕ ЗАМЕНЯЕТ СВЕРКУ. Совпадение картинок означает лишь, что
 * адреса совпали по этой свёртке; проверка перед отправкой средств
 * по-прежнему делается посимвольно.
 *
 * Симметрия по вертикали — не эстетика: зеркальные узоры человек
 * запоминает и различает заметно лучше, чем случайный шум.
 *
 * Рисуется своим кодом без внешней библиотеки: зависимость ради
 * двадцати строк арифметики расширяет поверхность атаки на приложение,
 * работающее рядом с ключами.
 */
export function AccountAvatar({ address, className }: AccountAvatarProps) {
  const seed = hashAddress(address)
  const hue = seed % 360
  const cells = buildCells(seed)

  return (
    <svg
      viewBox={`0 0 ${String(GRID)} ${String(GRID)}`}
      className={cn('size-9 shrink-0 rounded-full', className)}
      role="img"
      aria-label="Address fingerprint"
    >
      <rect width={GRID} height={GRID} fill={`oklch(0.3 0.09 ${String(hue)})`} />

      {cells.map(({ x, y }) => (
        <rect
          key={`${String(x)}-${String(y)}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={`oklch(0.72 0.16 ${String((hue + 40) % 360)})`}
        />
      ))}
    </svg>
  )
}

/**
 * Свёртка адреса в число.
 *
 * Алгоритм FNV-1a: простой, детерминированный и хорошо перемешивающий
 * короткие строки. Криптографическая стойкость здесь не требуется
 * и не подразумевается — от свёртки нужна только различимость картинок,
 * а не стойкость к подбору. Использовать её для чего-либо ещё нельзя.
 *
 * Регистр приводится к нижнему: один и тот же адрес приходит и в записи
 * EIP-55, и в нижнем регистре из ответов RPC, а две картинки для одного
 * адреса лишили бы отпечаток смысла.
 */
function hashAddress(address: string): number {
  const normalized = address.toLowerCase()

  let hash = 0x811c9dc5

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}

/** Заполненные ячейки решётки, зеркальные относительно вертикальной оси. */
function buildCells(seed: number): readonly { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []

  let state = seed

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
      /* Линейный конгруэнтный генератор: детерминированная
         последовательность из одной начальной величины. */
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0

      if (state % 100 < 50) {
        continue
      }

      cells.push({ x, y })

      const mirrored = GRID - 1 - x

      if (mirrored !== x) {
        cells.push({ x: mirrored, y })
      }
    }
  }

  return cells
}
