import { describe, expect, it } from 'vitest'

import { safeText, toSafeText } from './display-safety'

/* Коды записаны явно по той же причине, что и в самом модуле:
   невидимый символ в исходнике теста непроверяем при чтении. */
const RIGHT_TO_LEFT_OVERRIDE = '\u202E'
const ZERO_WIDTH_SPACE = '\u200B'
const BYTE_ORDER_MARK = '\uFEFF'
const SOFT_HYPHEN = '\u00AD'
const HIDDEN_MARKER = '\uFFFD'

describe('toSafeText: обычные строки', () => {
  it('пропускает безобидный символ без изменений', () => {
    const result = toSafeText('USDC')

    expect(result.text).toBe('USDC')
    expect(result.hasHiddenCharacters).toBe(false)
    expect(result.isTruncated).toBe(false)
  })

  it('пропускает кириллицу и пробелы внутри', () => {
    expect(toSafeText('Test network').text).toBe('Test network')
  })

  it('обрезает пробелы по краям', () => {
    expect(toSafeText('  USDC  ').text).toBe('USDC')
  })

  it('схлопывает повторяющиеся пробелы', () => {
    expect(toSafeText('USD    Coin').text).toBe('USD Coin')
  })
})

describe('toSafeText: скрытые символы заменяются, а не удаляются', () => {
  it('заменяет переопределение направления письма', () => {
    /* Удаление сделало бы подделку неотличимой от оригинала — ровно
       то, чего добивался автор контракта. */
    const result = toSafeText(`USDC${RIGHT_TO_LEFT_OVERRIDE}`)

    expect(result.text).toBe(`USDC${HIDDEN_MARKER}`)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('заменяет нулевой ширины пробел', () => {
    const result = toSafeText(`US${ZERO_WIDTH_SPACE}DC`)

    expect(result.text).toBe(`US${HIDDEN_MARKER}DC`)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('заменяет метку порядка байтов', () => {
    expect(toSafeText(`${BYTE_ORDER_MARK}USDC`).hasHiddenCharacters).toBe(true)
  })

  it('заменяет мягкий перенос', () => {
    expect(toSafeText(`US${SOFT_HYPHEN}DC`).hasHiddenCharacters).toBe(true)
  })

  it('заменяет перевод строки', () => {
    /* Перевод строки в имени токена ломает вёрстку списка и позволяет
       визуально подделать соседнюю строку. */
    const result = toSafeText('USDC\nПодтверждено')

    expect(result.text).not.toContain('\n')
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('подделка остаётся отличимой от настоящей строки', () => {
    /* Главное свойство: настоящий и поддельный символ на экране
       не совпадают. */
    const genuine = toSafeText('USDC')
    const forged = toSafeText(`USD${ZERO_WIDTH_SPACE}C`)

    expect(forged.text).not.toBe(genuine.text)
  })

  it('несколько скрытых символов заменяются каждый', () => {
    const result = toSafeText(`${ZERO_WIDTH_SPACE}US${ZERO_WIDTH_SPACE}DC`)

    expect(result.text).toBe(`${HIDDEN_MARKER}US${HIDDEN_MARKER}DC`)
  })
})

describe('toSafeText: длина', () => {
  it('усекает слишком длинную строку', () => {
    /* Длинное имя вытесняет с экрана сумму и адрес — то, ради чего
       пользователь на строку смотрит. */
    const result = toSafeText('а'.repeat(200))

    expect(result.isTruncated).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(65)
    expect(result.text.endsWith('…')).toBe(true)
  })

  it('строку по границе не усекает', () => {
    const result = toSafeText('а'.repeat(64))

    expect(result.isTruncated).toBe(false)
  })
})

describe('safeText', () => {
  it('возвращает только текст', () => {
    expect(safeText(`USDC${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(`USDC${HIDDEN_MARKER}`)
  })

  it('пустая строка остаётся пустой', () => {
    expect(safeText('')).toBe('')
  })
})

describe('Смешение письменностей', () => {
  it('латиница с кириллицей внутри слова помечается', () => {
    /* `Аave` с кириллической `А` выглядит безупречно: скрытых символов
       нет, буквы обычные и видимые. */
    expect(toSafeText('\u0410ave').hasMixedScripts).toBe(true)
  })

  it('греческая буква в латинском слове помечается', () => {
    expect(toSafeText('Uniswa\u03c1').hasMixedScripts).toBe(true)
  })

  it('однородное имя не помечается', () => {
    expect(toSafeText('Uniswap').hasMixedScripts).toBe(false)
    expect(toSafeText('Кошелёк').hasMixedScripts).toBe(false)
  })

  it('двуязычная строка из разных слов не помечается', () => {
    /* Смешение считается пословно: «Aave — Займы» это обычный текст,
       а не подделка. Ложная тревога приучает не читать
       предупреждения. */
    expect(toSafeText('Aave — Займы').hasMixedScripts).toBe(false)
  })

  it('цифры и знаки письменности не образуют', () => {
    expect(toSafeText('USDC-2').hasMixedScripts).toBe(false)
    expect(toSafeText('1inch').hasMixedScripts).toBe(false)
  })

  it('признак отличается от скрытых символов', () => {
    /* Разные признаки требуют разных объяснений: в одном случае
       в строке есть невидимое, в другом — всё видимо, но не из того
       алфавита. */
    const mixed = toSafeText('\u0410ave')

    expect(mixed.hasMixedScripts).toBe(true)
    expect(mixed.hasHiddenCharacters).toBe(false)
  })
})
