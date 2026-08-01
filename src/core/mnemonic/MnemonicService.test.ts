import { beforeEach, describe, expect, it } from 'vitest'

import { SecretBuffer } from '@/core/encryption'
import {
  InvalidArgumentError,
  InvalidMnemonicError,
  MNEMONIC_INVALID_REASON,
  SecretBufferWipedError,
} from '@/core/errors'

import { MnemonicService } from './MnemonicService'
import { MNEMONIC_STRENGTH, VALID_WORD_COUNTS } from './types'
import { BIP39_VECTORS, TREZOR_PASSPHRASE, bytesToHex, hexToBytes } from './vectors'

const VALID_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const VALID_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

let service: MnemonicService

beforeEach(() => {
  service = new MnemonicService()
})

describe('MnemonicService: соответствие официальным векторам BIP-39', () => {
  it.each(BIP39_VECTORS)('энтропия $entropy даёт ожидаемую фразу', ({ entropy, mnemonic }) => {
    const buffer = service.fromEntropy(hexToBytes(entropy))

    try {
      expect(service.revealPhrase(buffer)).toBe(mnemonic)
    } finally {
      buffer.wipe()
    }
  })

  it.each(BIP39_VECTORS)(
    'фраза для $entropy восстанавливает исходную энтропию',
    ({ entropy, mnemonic }) => {
      const buffer = service.fromPhrase(mnemonic)
      const recovered = service.toEntropy(buffer)

      try {
        expect(bytesToHex(recovered.bytes)).toBe(entropy)
      } finally {
        recovered.wipe()
        buffer.wipe()
      }
    },
  )

  it.each(BIP39_VECTORS.filter((vector) => vector.seed !== null))(
    'seed для $entropy совпадает с эталоном',
    async ({ mnemonic, seed }) => {
      const buffer = service.fromPhrase(mnemonic)
      const derived = await service.toSeed(buffer, TREZOR_PASSPHRASE)

      try {
        expect(bytesToHex(derived.bytes)).toBe(seed)
      } finally {
        derived.wipe()
        buffer.wipe()
      }
    },
  )
})

describe('MnemonicService: генерация', () => {
  it('по умолчанию создаёт 12 слов', () => {
    const buffer = service.generate()

    try {
      expect(service.toWords(buffer)).toHaveLength(12)
    } finally {
      buffer.wipe()
    }
  })

  it('создаёт 24 слова при стойкости 256 бит', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      expect(service.toWords(buffer)).toHaveLength(24)
    } finally {
      buffer.wipe()
    }
  })

  it('создаёт фразу, проходящую собственную валидацию', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      expect(service.validate(service.revealPhrase(buffer)).isValid).toBe(true)
    } finally {
      buffer.wipe()
    }
  })

  it('создаёт разные фразы при каждом вызове', () => {
    const first = service.generate()
    const second = service.generate()

    try {
      expect(service.revealPhrase(first)).not.toBe(service.revealPhrase(second))
    } finally {
      first.wipe()
      second.wipe()
    }
  })

  it('отвергает недопустимую стойкость', () => {
    expect(() => service.generate(192 as never)).toThrow(InvalidArgumentError)
  })

  it('использует только слова из словаря', () => {
    const buffer = service.generate(MNEMONIC_STRENGTH.Words24)

    try {
      for (const word of service.toWords(buffer)) {
        expect(service.findWordsByPrefix(word, 1)).toContain(word)
      }
    } finally {
      buffer.wipe()
    }
  })
})

describe('MnemonicService: валидация', () => {
  it('принимает корректную фразу из 12 слов', () => {
    expect(service.validate(VALID_12)).toEqual({
      isValid: true,
      wordCount: 12,
      reason: null,
      unknownWordIndexes: [],
    })
  })

  it('принимает корректную фразу из 24 слов', () => {
    expect(service.validate(VALID_24).isValid).toBe(true)
  })

  it.each(VALID_WORD_COUNTS)('признаёт допустимой длину %i слов', (count) => {
    /* BIP-39: каждые три слова кодируют 32 бита энтропии,
       то есть 4 байта. Отсюда 12 слов -> 16 байт, 24 слова -> 32 байта. */
    const entropyBytes = (count * 4) / 3
    const buffer = service.fromEntropy(new Uint8Array(entropyBytes).fill(1))

    try {
      expect(service.validate(service.revealPhrase(buffer)).wordCount).toBe(count)
    } finally {
      buffer.wipe()
    }
  })

  it('отвергает пустой ввод', () => {
    expect(service.validate('')).toMatchObject({
      isValid: false,
      reason: MNEMONIC_INVALID_REASON.Empty,
    })
  })

  it('отвергает ввод из одних пробелов', () => {
    expect(service.validate('   \n\t  ').reason).toBe(MNEMONIC_INVALID_REASON.Empty)
  })

  it('отвергает недопустимое число слов', () => {
    expect(service.validate('abandon abandon about')).toMatchObject({
      isValid: false,
      wordCount: 3,
      reason: MNEMONIC_INVALID_REASON.WordCount,
    })
  })

  it('отвергает 13 слов', () => {
    expect(service.validate(`${VALID_12} about`).reason).toBe(MNEMONIC_INVALID_REASON.WordCount)
  })

  it('указывает позиции слов вне словаря', () => {
    const phrase = VALID_12.replace(
      'abandon abandon abandon abandon',
      'abandon xyzzy abandon qwerty',
    )

    expect(service.validate(phrase)).toMatchObject({
      isValid: false,
      reason: MNEMONIC_INVALID_REASON.UnknownWord,
      unknownWordIndexes: [1, 3],
    })
  })

  it('не раскрывает сами ошибочные слова, только позиции', () => {
    const result = service.validate(VALID_12.replace('about', 'xyzzy'))

    expect(JSON.stringify(result)).not.toContain('xyzzy')
  })

  it('отвергает фразу с неверной контрольной суммой', () => {
    /* Все слова из словаря, но последнее не соответствует контрольной сумме. */
    const phrase = VALID_12.replace(/about$/, 'abandon')

    expect(service.validate(phrase)).toMatchObject({
      isValid: false,
      wordCount: 12,
      reason: MNEMONIC_INVALID_REASON.Checksum,
      unknownWordIndexes: [],
    })
  })

  it('отвергает переставленные местами слова корректной фразы', () => {
    const words = [...VALID_24.split(' ')]
    const [first] = words
    words[0] = words[23] as string
    words[23] = first as string

    expect(service.validate(words.join(' ')).isValid).toBe(false)
  })
})

describe('MnemonicService: нормализация ввода', () => {
  it('игнорирует ведущие и завершающие пробелы', () => {
    expect(service.validate(`   ${VALID_12}   `).isValid).toBe(true)
  })

  it('схлопывает повторяющиеся пробелы', () => {
    expect(service.validate(VALID_12.replace(/ /g, '   ')).isValid).toBe(true)
  })

  it('принимает перевод строки как разделитель', () => {
    expect(service.validate(VALID_12.replace(/ /g, '\n')).isValid).toBe(true)
  })

  it('приводит верхний регистр к нижнему', () => {
    expect(service.validate(VALID_12.toUpperCase()).isValid).toBe(true)
  })

  it('удаляет неразрывные пробелы из скопированного текста', () => {
    expect(service.validate(VALID_12.replace(/ /g, ' ')).isValid).toBe(true)
  })

  it('удаляет идеографические пробелы', () => {
    expect(service.validate(VALID_12.replace(/ /g, '\u3000')).isValid).toBe(true)
  })

  it('удаляет символы нулевой ширины и BOM', () => {
    expect(service.validate(`\u200B${VALID_12}\uFEFF`).isValid).toBe(true)
  })

  it('удаляет мягкие переносы из скопированного текста', () => {
    expect(service.validate(`aban\u00ADdon${VALID_12.slice(7)}`).isValid).toBe(true)
  })

  it('сохраняет нормализованный вид при импорте', () => {
    const buffer = service.fromPhrase(`  ${VALID_12.toUpperCase()}  `)

    try {
      expect(service.revealPhrase(buffer)).toBe(VALID_12)
    } finally {
      buffer.wipe()
    }
  })
})

describe('MnemonicService: импорт', () => {
  it('импортирует корректную фразу', () => {
    const buffer = service.fromPhrase(VALID_12)

    try {
      expect(buffer.isWiped).toBe(false)
      expect(service.toWords(buffer)).toHaveLength(12)
    } finally {
      buffer.wipe()
    }
  })

  it('сообщает причину отказа в поле reason', () => {
    expect.assertions(2)

    try {
      service.fromPhrase('abandon abandon about')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMnemonicError)
      expect((error as InvalidMnemonicError).reason).toBe(MNEMONIC_INVALID_REASON.WordCount)
    }
  })

  it('не раскрывает фразу в тексте ошибки', () => {
    expect.assertions(1)

    try {
      service.fromPhrase(VALID_12.replace(/about$/, 'abandon'))
    } catch (error) {
      expect((error as Error).message).not.toContain('abandon')
    }
  })
})

describe('MnemonicService: экспорт и энтропия', () => {
  it('раскрывает фразу списком слов', () => {
    const buffer = service.fromPhrase(VALID_12)

    try {
      const words = service.toWords(buffer)

      expect(words).toHaveLength(12)
      expect(words[11]).toBe('about')
    } finally {
      buffer.wipe()
    }
  })

  it('обратим: энтропия -> фраза -> энтропия', () => {
    const original = new Uint8Array(32)
    original.set([1, 2, 3, 4, 5])

    const buffer = service.fromEntropy(original)
    const recovered = service.toEntropy(buffer)

    try {
      expect(bytesToHex(recovered.bytes)).toBe(bytesToHex(original))
    } finally {
      recovered.wipe()
      buffer.wipe()
    }
  })

  it('отвергает энтропию недопустимой длины', () => {
    expect(() => service.fromEntropy(new Uint8Array(17))).toThrow(InvalidArgumentError)
  })

  it('отвергает пустую энтропию', () => {
    expect(() => service.fromEntropy(new Uint8Array(0))).toThrow(InvalidArgumentError)
  })

  it('отказывается извлечь энтропию из повреждённой фразы', () => {
    const broken = SecretBuffer.fromUtf8(VALID_12.replace(/about$/, 'abandon'))

    try {
      expect(() => service.toEntropy(broken)).toThrow(InvalidMnemonicError)
    } finally {
      broken.wipe()
    }
  })
})

describe('MnemonicService: вывод seed', () => {
  it('даёт ровно 64 байта', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const seed = await service.toSeed(buffer)

    try {
      expect(seed.bytes).toHaveLength(64)
    } finally {
      seed.wipe()
      buffer.wipe()
    }
  })

  it('детерминирован для одной и той же фразы', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const first = await service.toSeed(buffer)
    const second = await service.toSeed(buffer)

    try {
      expect(bytesToHex(first.bytes)).toBe(bytesToHex(second.bytes))
    } finally {
      first.wipe()
      second.wipe()
      buffer.wipe()
    }
  })

  it('парольная фраза полностью меняет seed', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const withoutPassphrase = await service.toSeed(buffer)
    const withPassphrase = await service.toSeed(buffer, 'дополнительный пароль')

    try {
      expect(bytesToHex(withoutPassphrase.bytes)).not.toBe(bytesToHex(withPassphrase.bytes))
    } finally {
      withoutPassphrase.wipe()
      withPassphrase.wipe()
      buffer.wipe()
    }
  })

  it('различает пустую и отсутствующую парольную фразу как одно и то же', async () => {
    const buffer = service.fromPhrase(VALID_12)
    const implicit = await service.toSeed(buffer)
    const explicit = await service.toSeed(buffer, '')

    try {
      expect(bytesToHex(implicit.bytes)).toBe(bytesToHex(explicit.bytes))
    } finally {
      implicit.wipe()
      explicit.wipe()
      buffer.wipe()
    }
  })

  it('отказывается работать с затёртым буфером', async () => {
    const buffer = service.fromPhrase(VALID_12)
    buffer.wipe()

    await expect(service.toSeed(buffer)).rejects.toThrow(SecretBufferWipedError)
  })
})

describe('MnemonicService: подсказки при вводе', () => {
  it('находит слова по префиксу', () => {
    expect(service.findWordsByPrefix('aban')).toContain('abandon')
  })

  it('ограничивает число подсказок', () => {
    expect(service.findWordsByPrefix('a', 3)).toHaveLength(3)
  })

  it('возвращает пустой список для пустого префикса', () => {
    expect(service.findWordsByPrefix('')).toEqual([])
  })

  it('возвращает пустой список для несуществующего префикса', () => {
    expect(service.findWordsByPrefix('qwertyuiop')).toEqual([])
  })

  it('нечувствителен к регистру', () => {
    expect(service.findWordsByPrefix('ABAN')).toContain('abandon')
  })

  it('возвращает пустой список при нулевом лимите', () => {
    expect(service.findWordsByPrefix('aban', 0)).toEqual([])
  })
})
