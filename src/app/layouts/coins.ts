export interface ICoin {
  /** Left offset as a percent of screen width. */
  readonly left: number

  /** Diameter in pixels. */
  readonly size: number

  /** Fall duration in seconds. */
  readonly duration: number

  /** Start delay in seconds. A negative value shifts the phase backward. */
  readonly delay: number

  /** Horizontal drift over the whole fall, in pixels. */
  readonly drift: number

  /** Opacity. Smaller coins are paler — that creates depth. */
  readonly opacity: number

  /** Full rotation angle over the fall. */
  readonly spin: number
}

/**
 * Coin layout.
 *
 * VALUES ARE EXPLICIT, NOT RANDOM. A random layout would change on
 * every render and sometimes pile up at one edge. Positions here are
 * spread across the width, and durations are deliberately dissimilar:
 * matching periods would produce a noticeable fall "in formation".
 *
 * NEGATIVE DELAYS SHIFT THE PHASE BACKWARD: coins are already in
 * flight when the screen opens. Without that the first seconds after
 * launch would be empty, and only the patient would notice the effect.
 *
 * Thirteen coins is the compromise: fewer looks like a random scatter,
 * noticeably more feels like snowfall and starts to distract from text.
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
