import { describe, expect, it } from 'vitest'

import { normalizeEnsName, toSafeText, safeText } from '@/core'

/**
 * Опасные символы собираются из кодов, а не пишутся литералами.
 *
 * Невидимый символ внутри строки исходного кода невозможно увидеть при
 * чтении — ровно по той причине, по которой он опасен в показываемом
 * тексте.
 */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const SOFT_HYPHEN = String.fromCodePoint(0x00ad)
const CYRILLIC_A = String.fromCodePoint(0x0430)

describe('Обезвреживание текста из контрактов и от сторонних сервисов', () => {
  it('переопределение направления письма не проходит на экран', () => {
    /* U+202E показывает текст задом наперёд: так подделывают символы
       токенов и имена сетей. */
    const result = toSafeText(`USD${RIGHT_TO_LEFT_OVERRIDE}C`)

    expect(result.text).not.toContain(RIGHT_TO_LEFT_OVERRIDE)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it.each([
    ['нулевой ширины пробел', ZERO_WIDTH_SPACE],
    ['мягкий перенос', SOFT_HYPHEN],
  ])('невидимый символ (%s) помечается, а не удаляется молча', (_name, character) => {
    /* Удалив невидимку, мы сделали бы подделку неотличимой
       от оригинала — ровно то, чего добивался автор контракта. */
    const result = toSafeText(`USD${character}C`)

    expect(result.hasHiddenCharacters).toBe(true)
    expect(result.text).not.toBe('USDC')
  })

  it('перевод строки не ломает соседнюю строку списка', () => {
    const result = toSafeText('USDC\nПодтверждено')

    expect(result.text).not.toContain('\n')
  })

  it('длинное имя не вытесняет с экрана сумму', () => {
    /* Автор контракта вправе назвать токен как угодно; занимать этим
       весь экран он права не имеет. */
    const result = toSafeText('A'.repeat(500))

    expect(result.isTruncated).toBe(true)
    expect(result.text.length).toBeLessThan(100)
  })

  it('обычный текст проходит без изменений', () => {
    /* Ложные срабатывания приучают не читать предупреждения. */
    const result = toSafeText('Tether USD')

    expect(result.text).toBe('Tether USD')
    expect(result.hasHiddenCharacters).toBe(false)
    expect(result.isTruncated).toBe(false)
  })

  it('краткая форма даёт тот же текст', () => {
    expect(safeText(`USD${ZERO_WIDTH_SPACE}C`)).toBe(toSafeText(`USD${ZERO_WIDTH_SPACE}C`).text)
  })

  it('разметка остаётся текстом и не становится разметкой', () => {
    /* React экранирует сам; проверка закрепляет, что обезвреживание
       не превращает строку во что-то исполняемое. */
    const payload = '<img src=x onerror=alert(1)>'

    expect(toSafeText(payload).text).toBe(payload)
  })
})

describe('Имена ENS: подмена не доходит до пользователя', () => {
  it('смешение письменностей внутри метки отвергается', () => {
    const spoofed = `vit${CYRILLIC_A}lik.eth`

    expect(spoofed).not.toBe('vitalik.eth')
    expect(normalizeEnsName(spoofed)).toBeNull()
  })

  it('невидимый символ не создаёт второго имени', () => {
    /* Обе записи обязаны давать один узел: иначе они указывали бы
       на разных получателей при одинаковом виде. */
    expect(normalizeEnsName(`vitalik${ZERO_WIDTH_SPACE}.eth`)).toBe(normalizeEnsName('vitalik.eth'))
  })

  it('punycode отвергается', () => {
    /* Метка `xn--` хэшируется как есть, а разворачивается в юникод
       где-то ещё. */
    expect(normalizeEnsName('xn--80ak6aa92e.eth')).toBeNull()
  })

  it('домен верхнего уровня получателем не считается', () => {
    expect(normalizeEnsName('eth')).toBeNull()
  })
})
