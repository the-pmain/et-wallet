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
  it('проверяет три слова', () => {
    expect(createConfirmationChallenge(WORDS).positions).toHaveLength(3)
  })

  it('не повторяет позиции', () => {
    const { positions } = createConfirmationChallenge(WORDS)

    expect(new Set(positions).size).toBe(positions.length)
  })

  it('предлагает четыре варианта на каждое слово', () => {
    for (const options of createConfirmationChallenge(WORDS).options) {
      expect(options).toHaveLength(4)
    }
  })

  it('включает правильный ответ в варианты', () => {
    const challenge = createConfirmationChallenge(WORDS)

    challenge.positions.forEach((position, index) => {
      expect(challenge.options[index]).toContain(WORDS[position])
    })
  })

  it('не повторяет варианты внутри вопроса', () => {
    for (const options of createConfirmationChallenge(WORDS).options) {
      expect(new Set(options).size).toBe(options.length)
    }
  })

  it('берёт отвлекающие варианты из самой фразы', () => {
    /* Словарная выборка по одному префиксу выдаёт себя: правильное слово
       выделяется среди похожих друг на друга чужих, и пользователь
       угадывает его не вспоминая. */
    for (const options of createConfirmationChallenge(WORDS).options) {
      for (const option of options) {
        expect(WORDS).toContain(option)
      }
    }
  })

  it('не ставит правильный ответ всегда на одно место', () => {
    /* Постоянная позиция правильного ответа превратила бы проверку
       в нажатие одной и той же кнопки. */
    const indexes = new Set<number>()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const challenge = createConfirmationChallenge(WORDS)
      const position = challenge.positions[0] as number

      indexes.add((challenge.options[0] ?? []).indexOf(WORDS[position] as string))
    }

    expect(indexes.size).toBeGreaterThan(1)
  })

  it('выбирает разные позиции при повторных вызовах', () => {
    const seen = new Set<string>()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      seen.add(createConfirmationChallenge(WORDS).positions.join(','))
    }

    expect(seen.size).toBeGreaterThan(1)
  })

  it('работает с фразой из 24 слов', () => {
    const long = [...WORDS, ...WORDS.map((word) => `${word}-2`)]

    expect(createConfirmationChallenge(long).positions).toHaveLength(3)
  })
})

describe('isConfirmationComplete', () => {
  it('подтверждает верные ответы', () => {
    const challenge = createConfirmationChallenge(WORDS)
    const answers = challenge.positions.map((position) => WORDS[position] as string)

    expect(isConfirmationComplete(challenge, answers, WORDS)).toBe(true)
  })

  it('отвергает неполные ответы', () => {
    const challenge = createConfirmationChallenge(WORDS)

    expect(isConfirmationComplete(challenge, [null, null, null], WORDS)).toBe(false)
  })

  it('отвергает один неверный ответ', () => {
    const challenge = createConfirmationChallenge(WORDS)
    const answers = challenge.positions.map((position) => WORDS[position] as string)
    answers[0] = 'неверное'

    expect(isConfirmationComplete(challenge, answers, WORDS)).toBe(false)
  })
})
