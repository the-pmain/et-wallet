import { cn } from '@/shared/lib/utils'

interface ConversationAvatarProps {
  readonly email: string
  readonly className?: string
}

/** Identicon for a conversation counterparty, mirroring admin user avatars. */
export function ConversationAvatar({ email, className }: ConversationAvatarProps) {
  const seed = hashIdentity(email.toLowerCase())
  const hue = seed % 360
  const cells = buildCells(seed)

  return (
    <svg
      viewBox="0 0 5 5"
      className={cn('size-10 shrink-0 rounded-full', className)}
      role="img"
      aria-label={`Avatar for ${email}`}
    >
      <rect width={5} height={5} fill={`oklch(0.32 0.1 ${String(hue)})`} />

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
  const grid = 5
  const half = Math.ceil(grid / 2)
  const cells: { x: number; y: number }[] = []
  let state = seed

  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < half; x += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0

      if (state % 100 < 50) {
        continue
      }

      cells.push({ x, y })

      const mirrored = grid - 1 - x

      if (mirrored !== x) {
        cells.push({ x: mirrored, y })
      }
    }
  }

  return cells
}
