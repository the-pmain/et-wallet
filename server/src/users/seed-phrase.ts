import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/**
 * Допустимые длины BIP-39: 128–256 бит энтропии.
 *
 * Создание кошелька даёт 12 слов, импорт может принести любую
 * стандартную длину. Отказ 15/18/21 слова отрезал бы чужую фразу.
 */
const VALID_WORD_COUNTS: ReadonlySet<number> = new Set([12, 15, 18, 21, 24])

/**
 * Канонический вид колонки `seed_phrase`.
 *
 * Слова через запятую, без пробелов: `word1,word2,…,word12`.
 * Пробельный BIP-39 и вариант `word1, word2` не принимаются.
 */
const COMMA_PHRASE = /^[a-z]+(?:,[a-z]+)+$/u

/**
 * Проверяет `seed_phrase` из тела создания пользователя.
 *
 * `null` — строка пустая, не того формата, не из словаря BIP-39
 * или с неверной контрольной суммой. Сообщение наружу одно:
 * фраза непригодна. Различать причину не нужно.
 */
export function readSeedPhrase(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const phrase = value.trim()

  if (!COMMA_PHRASE.test(phrase)) {
    return null
  }

  const words = phrase.split(',')

  if (!VALID_WORD_COUNTS.has(words.length)) {
    return null
  }

  if (!validateMnemonic(words.join(' '), wordlist)) {
    return null
  }

  return words.join(',')
}
