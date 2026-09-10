import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  mnemonicToSeedWebcrypto,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

import { SecretBuffer, getRandomBytes, wipeBytes, type ISecretBuffer } from '@/core/encryption'
import {
  InvalidArgumentError,
  InvalidMnemonicError,
  MNEMONIC_INVALID_REASON,
  type MnemonicInvalidReason,
} from '@/core/errors'

import type { IMnemonicService } from './contracts'
import { normalizeMnemonicInput, splitWords } from './normalize'
import {
  MNEMONIC_STRENGTH,
  VALID_WORD_COUNTS,
  type IMnemonicValidationResult,
  type MnemonicStrength,
} from './types'

/** Допустимые размеры энтропии в байтах: 128, 160, 192, 224 и 256 бит. */
const VALID_ENTROPY_LENGTHS: readonly number[] = [16, 20, 24, 28, 32]

/** Ограничение числа подсказок автодополнения по умолчанию. */
const DEFAULT_SUGGESTION_LIMIT = 8

/**
 * Множество слов словаря.
 *
 * Set вместо `Array.includes`: проверка каждого из 24 слов линейным поиском
 * по 2048 элементам выполняется на каждое нажатие клавиши при вводе фразы.
 * Построение множества один раз при загрузке модуля дешевле.
 */
const WORDLIST_SET = new Set(wordlist)

/**
 * Реализация работы с мнемоническими фразами BIP-39.
 *
 * ОГРАНИЧЕНИЕ ПО ЯЗЫКУ. Поддерживается только английский словарь.
 * Он жёстко зашит и НЕ внедряется через зависимости: возможность подменить
 * словарь означала бы возможность подсунуть набор слов, для которого
 * злоумышленник знает соответствие индексов, и получить предсказуемую
 * энтропию из «правильной» на вид фразы.
 *
 * Фраза на другом языке будет отвергнута как некорректная. Это ограничение,
 * а не ошибка; оно зафиксировано в README.
 *
 * ОГРАНИЧЕНИЕ ПО ПАМЯТИ. Каждый вызов, обращающийся к `@scure/bip39`,
 * создаёт неочищаемую строку с фразой. Ниже она везде живёт ровно одно
 * выражение, но полностью устранить её нельзя.
 */
export class MnemonicService implements IMnemonicService {
  generate(strength: MnemonicStrength = MNEMONIC_STRENGTH.Words12): ISecretBuffer {
    if (strength !== MNEMONIC_STRENGTH.Words12 && strength !== MNEMONIC_STRENGTH.Words24) {
      throw new InvalidArgumentError('strength', 'only the values 128 and 256 are allowed')
    }

    /* Энтропия берётся собственной функцией, а не встроенным
       `generateMnemonic`, ради проверки на неисправный генератор:
       нулевой буфер от сломанного полифила должен остановить создание
       кошелька, а не привести к предсказуемому ключу. */
    const entropy = getRandomBytes(strength / 8)

    try {
      return SecretBuffer.fromUtf8(entropyToMnemonic(entropy, wordlist))
    } finally {
      wipeBytes(entropy)
    }
  }

  validate(phrase: string): IMnemonicValidationResult {
    const normalized = normalizeMnemonicInput(phrase)
    const words = splitWords(normalized)

    if (words.length === 0) {
      return MnemonicService.#invalid(0, MNEMONIC_INVALID_REASON.Empty)
    }

    if (!VALID_WORD_COUNTS.includes(words.length)) {
      return MnemonicService.#invalid(words.length, MNEMONIC_INVALID_REASON.WordCount)
    }

    /* Неизвестные слова выявляются до проверки контрольной суммы: опечатка
       встречается несравнимо чаще перепутанного порядка, и подсказка про
       конкретное слово полезнее сообщения про контрольную сумму. */
    const unknownWordIndexes: number[] = []

    words.forEach((word, index) => {
      if (!WORDLIST_SET.has(word)) {
        unknownWordIndexes.push(index)
      }
    })

    if (unknownWordIndexes.length > 0) {
      return {
        isValid: false,
        wordCount: words.length,
        reason: MNEMONIC_INVALID_REASON.UnknownWord,
        unknownWordIndexes,
      }
    }

    if (!validateMnemonic(normalized, wordlist)) {
      return MnemonicService.#invalid(words.length, MNEMONIC_INVALID_REASON.Checksum)
    }

    return {
      isValid: true,
      wordCount: words.length,
      reason: null,
      unknownWordIndexes: [],
    }
  }

  fromPhrase(phrase: string): ISecretBuffer {
    const result = this.validate(phrase)

    if (!result.isValid) {
      /* Причина всегда заполнена при isValid === false. Проверка нужна
         компилятору, а не логике. */
      throw new InvalidMnemonicError(result.reason ?? MNEMONIC_INVALID_REASON.Checksum)
    }

    return SecretBuffer.fromUtf8(normalizeMnemonicInput(phrase))
  }

  revealPhrase(mnemonic: ISecretBuffer): string {
    return new TextDecoder().decode(mnemonic.bytes)
  }

  toWords(mnemonic: ISecretBuffer): readonly string[] {
    return splitWords(this.revealPhrase(mnemonic))
  }

  async toSeed(mnemonic: ISecretBuffer, passphrase = ''): Promise<ISecretBuffer> {
    const phrase = this.revealPhrase(mnemonic)

    /* Предпочтителен нативный PBKDF2 из Web Crypto: он выполняется вне
       кучи JavaScript, не оставляя промежуточных состояний HMAC в объектах,
       которые потом невозможно затереть.

       Запасной путь — реализация из @noble/hashes. Это не понижение
       стойкости: алгоритм и параметры те же, отличается лишь место
       выполнения. Нужен для сред без crypto.subtle, в частности для
       jsdom в тестах. */
    const seed = MnemonicService.#hasWebCryptoSubtle()
      ? await mnemonicToSeedWebcrypto(phrase, passphrase)
      : await mnemonicToSeed(phrase, passphrase)

    return SecretBuffer.own(seed)
  }

  toEntropy(mnemonic: ISecretBuffer): ISecretBuffer {
    const phrase = this.revealPhrase(mnemonic)

    try {
      return SecretBuffer.own(mnemonicToEntropy(phrase, wordlist))
    } catch {
      /* Библиотека сообщает об ошибке текстом, разбирать который нельзя:
         формулировка не является частью её публичного контракта. Причина
         восстанавливается собственной валидацией. */
      const result = this.validate(phrase)

      throw new InvalidMnemonicError(result.reason ?? MNEMONIC_INVALID_REASON.Checksum)
    }
  }

  fromEntropy(entropy: Uint8Array): ISecretBuffer {
    if (!VALID_ENTROPY_LENGTHS.includes(entropy.length)) {
      throw new InvalidArgumentError(
        'entropy',
        `allowed lengths are ${VALID_ENTROPY_LENGTHS.join(', ')} bytes, received ${String(entropy.length)}`,
      )
    }

    return SecretBuffer.fromUtf8(entropyToMnemonic(entropy, wordlist))
  }

  findWordsByPrefix(prefix: string, limit: number = DEFAULT_SUGGESTION_LIMIT): readonly string[] {
    const normalized = normalizeMnemonicInput(prefix)

    if (normalized.length === 0 || limit <= 0) {
      return []
    }

    const matches: string[] = []

    for (const word of wordlist) {
      if (word.startsWith(normalized)) {
        matches.push(word)

        if (matches.length === limit) {
          break
        }
      }
    }

    return matches
  }

  static #invalid(wordCount: number, reason: MnemonicInvalidReason): IMnemonicValidationResult {
    return { isValid: false, wordCount, reason, unknownWordIndexes: [] }
  }

  static #hasWebCryptoSubtle(): boolean {
    return typeof globalThis.crypto?.subtle?.importKey === 'function'
  }
}
