import { getRandomBytes } from '@/core'

const WORDS_TO_CONFIRM = 3
const OPTIONS_PER_WORD = 4

export interface IConfirmationChallenge {
  readonly positions: readonly number[]
  readonly options: readonly (readonly string[])[]
}

/**
 * Builds a challenge that the written phrase was recorded.
 *
 * WHY THIS EXISTS. A user who did not write the phrase down will lose
 * funds at the first device loss and discover it too late. The check
 * does not prove the phrase is on paper, but it filters people who
 * hit "Next" without looking.
 *
 * Three words, not all twelve: a full retype is so tiring that the
 * user copies the phrase through the clipboard, and the check becomes
 * a formality.
 *
 * Positions and distractors come from a cryptographically strong
 * source. Predicting positions is useless by itself, but a separate
 * weak generator "for non-secret use" will eventually be applied
 * to a secret.
 */
export function createConfirmationChallenge(words: readonly string[]): IConfirmationChallenge {
  const positions = pickDistinct(words.length, Math.min(WORDS_TO_CONFIRM, words.length))

  const options = positions.map((position) => {
    const correct = words[position] as string

    /* Distractors come from the phrase itself, not the dictionary.
       A dictionary sample by one prefix gives itself away: the
       correct word stands out among similar strangers, and the user
       guesses it without remembering. Words from the same phrase
       look like the correct one, so what is checked is order —
       the reason this check exists. */
    const distractors = shuffle(words.filter((candidate) => candidate !== correct)).slice(
      0,
      OPTIONS_PER_WORD - 1,
    )

    return shuffle([correct, ...distractors])
  })

  return { positions, options }
}

export function isConfirmationComplete(
  challenge: IConfirmationChallenge,
  answers: readonly (string | null)[],
  words: readonly string[],
): boolean {
  return challenge.positions.every((position, index) => answers[index] === words[position])
}

function pickDistinct(size: number, count: number): readonly number[] {
  const chosen = new Set<number>()

  while (chosen.size < count) {
    chosen.add(randomBelow(size))
  }

  return [...chosen].sort((left, right) => left - right)
}

/**
 * Shuffles an array uniformly.
 *
 * Fisher–Yates. A sort with a random comparator, often written in
 * its place, is uneven and on some engines undefined.
 */
function shuffle<TItem>(items: readonly TItem[]): TItem[] {
  const result = [...items]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomBelow(index + 1)
    const temporary = result[index] as TItem

    result[index] = result[target] as TItem
    result[target] = temporary
  }

  return result
}

/**
 * Random integer in `[0, bound)` without bias.
 *
 * A random byte modulo the bound favours lower values. Discarding
 * values from the incomplete range removes that bias.
 */
function randomBelow(bound: number): number {
  const limit = Math.floor(256 / bound) * bound

  for (;;) {
    const [byte] = getRandomBytes(1)

    if (byte !== undefined && byte < limit) {
      return byte % bound
    }
  }
}
