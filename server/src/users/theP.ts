import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Checks the presented value against column `the_p`.
 *
 * Comparison is over SHA-256, not raw strings of different lengths:
 * `timingSafeEqual` otherwise refuses to run, and an early `return`
 * on length would leak how many characters matched.
 */
export function thePMatches(stored: string | null | undefined, candidate: string): boolean {
  if (stored === null || stored === undefined) {
    return false
  }

  const left = createHash('sha256').update(stored, 'utf8').digest()
  const right = createHash('sha256').update(candidate, 'utf8').digest()

  return timingSafeEqual(left, right)
}
