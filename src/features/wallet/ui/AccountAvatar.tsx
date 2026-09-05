import { cn } from '@/shared/lib/utils'

interface AccountAvatarProps {
  readonly address: string
  readonly className?: string
  /** Screen-reader label. Defaults to the address fingerprint. */
  readonly label?: string
}

/** Cells per side. An odd count gives a central axis of symmetry. */
const GRID = 5

/** Half-width mirrored across the vertical axis. */
const HALF = Math.ceil(GRID / 2)

/**
 * Visual address fingerprint.
 *
 * This is a safety aid, not decoration. People recognize an address by
 * four to six characters, and crafting an address with matching ends is
 * cheap. The picture depends on all forty characters: a swapped address
 * changes the whole image, visible in peripheral vision.
 *
 * A matching picture only means the addresses matched this hash;
 * before sending funds the check is still character by character.
 *
 * Vertical symmetry is for memory, not aesthetics. Drawn in-house:
 * a dependency for twenty lines of arithmetic widens the attack
 * surface of an app that sits next to keys.
 */
export function AccountAvatar({
  address,
  className,
  label = 'Address fingerprint',
}: AccountAvatarProps) {
  const seed = hashAddress(address)
  const hue = seed % 360
  const cells = buildCells(seed)

  return (
    <svg
      viewBox={`0 0 ${String(GRID)} ${String(GRID)}`}
      className={cn('size-9 shrink-0 rounded-full', className)}
      role="img"
      aria-label={label}
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
 * Fold the address into a number.
 *
 * FNV-1a: simple, deterministic, mixes short strings well.
 * Cryptographic strength is neither required nor implied — only
 * picture distinctness. Do not reuse this hash for anything else.
 *
 * Lowercased first: the same address arrives in EIP-55 and in
 * lowercase from RPC; two pictures for one address would void the
 * fingerprint.
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

/** Filled grid cells, mirrored across the vertical axis. */
function buildCells(seed: number): readonly { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []

  let state = seed

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
      /* Linear congruential generator: a deterministic stream from one seed. */
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
