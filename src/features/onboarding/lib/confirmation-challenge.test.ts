import { describe, expect, it } from 'vitest'

import { createConfirmationChallenge, isConfirmationComplete } from './confirmation-challenge'

const WORDS = [
  'mercy',
  'saddle',
  'flight',
  'sphere',
  'digital',
  'deliver',
  'supreme',
  'amused',
  'stool',
  'install',
  'frown',
  'wrong',
]

describe('createConfirmationChallenge', () => {
  it('checks three words', () => {
    expect(createConfirmationChallenge(WORDS).positions).toHaveLength(3)
  })

  it('does not repeat positions', () => {
    const { positions } = createConfirmationChallenge(WORDS)

    expect(new Set(positions).size).toBe(positions.length)
  })

  it('offers four options per word', () => {
    for (const options of createConfirmationChallenge(WORDS).options) {
      expect(options).toHaveLength(4)
    }
  })

  it('includes the correct answer in the options', () => {
    const challenge = createConfirmationChallenge(WORDS)

    challenge.positions.forEach((position, index) => {
      expect(challenge.options[index]).toContain(WORDS[position])
    })
  })

  it('does not repeat options inside a question', () => {
    for (const options of createConfirmationChallenge(WORDS).options) {
      expect(new Set(options).size).toBe(options.length)
    }
  })

  it('takes distractors from the phrase itself', () => {
    /* A dictionary sample by one prefix gives itself away: the
       correct word stands out among similar strangers, and the user
       guesses it without remembering. */
    for (const options of createConfirmationChallenge(WORDS).options) {
      for (const option of options) {
        expect(WORDS).toContain(option)
      }
    }
  })

  it('does not always put the correct answer in one place', () => {
    /* A fixed position for the correct answer would turn the check
       into pressing the same button every time. */
    const indexes = new Set<number>()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const challenge = createConfirmationChallenge(WORDS)
      const position = challenge.positions[0] as number

      indexes.add((challenge.options[0] ?? []).indexOf(WORDS[position] as string))
    }

    expect(indexes.size).toBeGreaterThan(1)
  })

  it('picks different positions across calls', () => {
    const seen = new Set<string>()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      seen.add(createConfirmationChallenge(WORDS).positions.join(','))
    }

    expect(seen.size).toBeGreaterThan(1)
  })

  it('works with a 24-word phrase', () => {
    const long = [...WORDS, ...WORDS.map((word) => `${word}-2`)]

    expect(createConfirmationChallenge(long).positions).toHaveLength(3)
  })
})

describe('isConfirmationComplete', () => {
  it('accepts correct answers', () => {
    const challenge = createConfirmationChallenge(WORDS)
    const answers = challenge.positions.map((position) => WORDS[position] as string)

    expect(isConfirmationComplete(challenge, answers, WORDS)).toBe(true)
  })

  it('rejects incomplete answers', () => {
    const challenge = createConfirmationChallenge(WORDS)

    expect(isConfirmationComplete(challenge, [null, null, null], WORDS)).toBe(false)
  })

  it('rejects a single wrong answer', () => {
    const challenge = createConfirmationChallenge(WORDS)
    const answers = challenge.positions.map((position) => WORDS[position] as string)
    answers[0] = 'wrong'

    expect(isConfirmationComplete(challenge, answers, WORDS)).toBe(false)
  })
})
