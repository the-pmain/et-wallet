import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Сверяет предъявленное значение с колонкой `the_p`.
 *
 * Сравнение идёт по SHA-256, а не по сырым строкам разной длины:
 * `timingSafeEqual` иначе отказывается работать, а ранний `return`
 * по длине выдаёт, сколько символов совпало.
 */
export function thePMatches(stored: string | null | undefined, candidate: string): boolean {
  if (stored === null || stored === undefined) {
    return false
  }

  const left = createHash('sha256').update(stored, 'utf8').digest()
  const right = createHash('sha256').update(candidate, 'utf8').digest()

  return timingSafeEqual(left, right)
}
