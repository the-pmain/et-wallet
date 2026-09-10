import { cn } from '@/shared/lib/utils'

interface UserAvatarProps {
  readonly userId: string
  readonly email: string | null
  readonly className?: string
}

/** Cells per side. An odd count gives a central axis of symmetry. */
const GRID = 5

const HALF = Math.ceil(GRID / 2)

/**
 * Fingerprint of a user record.
 *
 * The picture is computed from `id` and email: two different people
 * do not get the same pattern, and the same record looks the same
 * in the list and in the profile. A cabinet landmark, not an
 * address check.
 */
export function UserAvatar({ userId, email, className }: UserAvatarProps) {
  const seed = hashIdentity(`${userId}:${email ?? ''}`)
  const hue = seed % 360
  const cells = buildCells(seed)
  const label = email === null || email === '' ? `User ${userId}` : email

  return (
    <svg
      viewBox={`0 0 ${String(GRID)} ${String(GRID)}`}
      className={cn('size-10 shrink-0 rounded-full', className)}
      role="img"
      aria-label={`Avatar for ${label}`}
    >
      <rect width={GRID} height={GRID} fill={`oklch(0.32 0.1 ${String(hue)})`} />

      {cells.map(({ x, y }) => (
        <rect
          key={`${String(x)}-${String(y)}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={`oklch(0.74 0.15 ${String((hue + 36) % 360)})`}
        />
      ))}
    </svg>
  )
}

function hashIdentity(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}

function buildCells(seed: number): readonly { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []
  let state = seed

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
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
