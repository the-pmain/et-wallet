import { getRandomBytes } from '@/core'

/** Сколько слов проверяется. */
const WORDS_TO_CONFIRM = 3

/** Сколько вариантов предлагается на каждое слово. */
const OPTIONS_PER_WORD = 4

export interface IConfirmationChallenge {
  /** Позиции проверяемых слов, начиная с нуля. */
  readonly positions: readonly number[]
  /** Варианты ответа для каждой позиции, в перемешанном порядке. */
  readonly options: readonly (readonly string[])[]
}

/**
 * Составляет задание на проверку записанной фразы.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Пользователь, не записавший фразу, потеряет средства
 * при первой же потере устройства и обнаружит это слишком поздно.
 * Проверка не гарантирует, что фраза записана на бумаге, но отсекает
 * тех, кто нажал «Далее» не глядя.
 *
 * Три слова, а не все двенадцать: полная перепечатка утомляет настолько,
 * что пользователь копирует фразу через буфер обмена, и проверка
 * превращается в формальность.
 *
 * Позиции и отвлекающие варианты берутся из криптостойкого источника.
 * Предсказание позиций само по себе ничего не даёт, но отдельный слабый
 * генератор «для несекретных нужд» неизбежно когда-нибудь применят
 * не по назначению.
 */
export function createConfirmationChallenge(words: readonly string[]): IConfirmationChallenge {
  const positions = pickDistinct(words.length, Math.min(WORDS_TO_CONFIRM, words.length))

  const options = positions.map((position) => {
    const correct = words[position] as string

    /* Отвлекающие варианты берутся из самой фразы, а не из словаря.
       Словарная выборка по одному префиксу выдаёт себя: правильное слово
       выделяется среди похожих друг на друга чужих, и пользователь
       угадывает его не вспоминая. Слова из той же фразы неотличимы
       от правильного, поэтому проверяется именно порядок — то, ради
       чего проверка и существует. */
    const distractors = shuffle(words.filter((candidate) => candidate !== correct)).slice(
      0,
      OPTIONS_PER_WORD - 1,
    )

    return shuffle([correct, ...distractors])
  })

  return { positions, options }
}

/** Все ли ответы совпадают с фразой. */
export function isConfirmationComplete(
  challenge: IConfirmationChallenge,
  answers: readonly (string | null)[],
  words: readonly string[],
): boolean {
  return challenge.positions.every((position, index) => answers[index] === words[position])
}

/** Выбирает заданное число различных индексов из диапазона. */
function pickDistinct(size: number, count: number): readonly number[] {
  const chosen = new Set<number>()

  while (chosen.size < count) {
    chosen.add(randomBelow(size))
  }

  return [...chosen].sort((left, right) => left - right)
}

/**
 * Равномерно перемешивает массив.
 *
 * Алгоритм Фишера—Йетса. Сортировка со случайным компаратором,
 * которую часто пишут вместо него, даёт неравномерное распределение
 * и в некоторых движках вовсе неопределённое поведение.
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
 * Случайное целое в диапазоне `[0, bound)` без смещения.
 *
 * Остаток от деления случайного байта на границу даёт перекос в пользу
 * младших значений. Отбрасывание значений из неполного диапазона
 * его устраняет.
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
