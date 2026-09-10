import { describe, expect, it } from 'vitest'

import { beautifyEnsName, isAsciiEnsName, looksLikeEnsName, normalizeEnsName } from './ens-name'

/**
 * Символы подмены собираются из кодов, а не пишутся литералами.
 *
 * Кириллическая «а» неотличима от латинской на экране, а нулевой ширины
 * пробел невидим вовсе. Записанные прямо в строке, они сделали бы этот
 * тест непроверяемым чтением — ровно по той причине, по которой они
 * опасны внутри имени.
 */
const CYRILLIC_A = String.fromCodePoint(0x0430)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const LATIN_V = 'v'

describe('looksLikeEnsName', () => {
  it.each(['vitalik.eth', 'a.b.eth', ' shop.eth '])('признаёт "%s" именем', (value) => {
    expect(looksLikeEnsName(value)).toBe(true)
  })

  it.each(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'vitalik', '', 'vitalik.', '0x'])(
    'не признаёт "%s" именем',
    (value) => {
      expect(looksLikeEnsName(value)).toBe(false)
    },
  )
})

describe('normalizeEnsName: что принимается', () => {
  it('снимает регистр и пробелы по краям', () => {
    expect(normalizeEnsName('  Vitalik.ETH ')).toBe('vitalik.eth')
  })

  it.each(['vitalik.eth', 'my-shop.eth', 'a1.b2.eth', '123.eth'])('принимает "%s"', (value) => {
    expect(normalizeEnsName(value)).toBe(value)
  })

  it.each(['-shop.eth', 'shop-.eth'])('принимает дефис по краю метки: "%s"', (value) => {
    /* DNS такое запрещает, ENSIP-15 — нет. Своя проверка строже
       стандарта означала бы отказ отправить на существующее имя. */
    expect(normalizeEnsName(value)).toBe(value)
  })

  it('принимает имя целиком из кириллицы', () => {
    expect(normalizeEnsName('ПРИВЕТ.eth')).toBe('привет.eth')
  })

  it('принимает эмодзи', () => {
    expect(normalizeEnsName('\u{1F600}.eth')).toBe('\u{1F600}.eth')
  })

  it('приводит диакритику к канонической форме', () => {
    expect(normalizeEnsName('ÅNGSTRÖM.eth')).toBe('ångström.eth')
  })
})

describe('normalizeEnsName: что отвергается', () => {
  it('отвергает смешение письменностей внутри метки', () => {
    /* Главная защита ENSIP-15. На экране имя неотличимо от
       `vitalik.eth`, а узел даёт другой — и, значит, другого
       получателя. */
    const spoofed = `vit${CYRILLIC_A}lik.eth`

    expect(spoofed).not.toBe('vitalik.eth')
    expect(normalizeEnsName(spoofed)).toBeNull()
  })

  it('отвергает смешение в обратную сторону', () => {
    expect(normalizeEnsName(`при${LATIN_V}ет.eth`)).toBeNull()
  })

  it('отвергает punycode', () => {
    /* Метка `xn--` хэшируется как есть, а разворачивается в юникод
       где-то ещё: две записи одного имени дали бы разные узлы. */
    expect(normalizeEnsName('xn--80ak6aa92e.eth')).toBeNull()
  })

  it('отвергает пустую метку', () => {
    expect(normalizeEnsName('a..eth')).toBeNull()
  })

  it('отвергает имя из одной метки', () => {
    /* Нормализацию `eth` проходит: это законная метка. Но домен
       верхнего уровня получателем быть не может, и это наша проверка,
       а не стандарта. */
    expect(normalizeEnsName('eth')).toBeNull()
  })

  it('отвергает пустой ввод', () => {
    expect(normalizeEnsName('   ')).toBeNull()
  })

  it('отвергает слишком длинное имя', () => {
    const name = `${Array.from({ length: 32 }, () => 'abcdefgh').join('.')}.eth`

    expect(name.length).toBeGreaterThan(255)
    expect(normalizeEnsName(name)).toBeNull()
  })
})

describe('normalizeEnsName: невидимые символы', () => {
  it('невидимый символ не создаёт второго имени', () => {
    /* ENSIP-15 относит нулевой ширины пробел к игнорируемым: он
       вычищается, а не отвергается. Существенно здесь не то, каким
       способом, а то, что подделка невозможна — обе записи дают ОДНО
       имя и, значит, один адрес. */
    const withHidden = `vitalik${ZERO_WIDTH_SPACE}.eth`

    expect(withHidden).not.toBe('vitalik.eth')
    expect(normalizeEnsName(withHidden)).toBe('vitalik.eth')
    expect(normalizeEnsName(withHidden)).toBe(normalizeEnsName('vitalik.eth'))
  })
})

describe('beautifyEnsName', () => {
  it('оставляет обычное имя без изменений', () => {
    expect(beautifyEnsName('vitalik.eth')).toBe('vitalik.eth')
  })

  it('возвращает эмодзи цветное начертание', () => {
    /* Нормализация снимает вариационный селектор ради единственности
       узла; на экране эмодзи должно выглядеть привычно. */
    const normalized = normalizeEnsName('\u{1F600}.eth')

    expect(normalized).not.toBeNull()
    expect(beautifyEnsName(normalized as string)).toBe('\u{1F600}\u{FE0F}.eth')
  })
})

describe('isAsciiEnsName', () => {
  it('латинское имя признаёт ASCII', () => {
    expect(isAsciiEnsName('vitalik.eth')).toBe(true)
  })

  it.each(['привет.eth', 'ångström.eth', '\u{1F600}.eth'])('имя "%s" ASCII не считает', (value) => {
    expect(isAsciiEnsName(value)).toBe(false)
  })
})
