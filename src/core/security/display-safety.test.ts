import { describe, expect, it } from 'vitest'

import { safeText, toSafeText } from './display-safety'

/* Codes are written explicitly for the same reason as in the module:
   an invisible character in the test source is unverifiable when
   reading. */
const RIGHT_TO_LEFT_OVERRIDE = '\u202E'
const ZERO_WIDTH_SPACE = '\u200B'
const BYTE_ORDER_MARK = '\uFEFF'
const SOFT_HYPHEN = '\u00AD'
const HIDDEN_MARKER = '\uFFFD'

describe('toSafeText: ordinary strings', () => {
  it('passes a harmless character through unchanged', () => {
    const result = toSafeText('USDC')

    expect(result.text).toBe('USDC')
    expect(result.hasHiddenCharacters).toBe(false)
    expect(result.isTruncated).toBe(false)
  })

  it('passes Cyrillic and inner spaces through', () => {
    expect(toSafeText('Test network').text).toBe('Test network')
  })

  it('trims edge spaces', () => {
    expect(toSafeText('  USDC  ').text).toBe('USDC')
  })

  it('collapses repeated spaces', () => {
    expect(toSafeText('USD    Coin').text).toBe('USD Coin')
  })
})

describe('toSafeText: hidden characters are replaced, not deleted', () => {
  it('replaces a writing-direction override', () => {
    /* Deleting it would make the fake indistinguishable from the
       original — exactly what the contract author wanted. */
    const result = toSafeText(`USDC${RIGHT_TO_LEFT_OVERRIDE}`)

    expect(result.text).toBe(`USDC${HIDDEN_MARKER}`)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('replaces a zero-width space', () => {
    const result = toSafeText(`US${ZERO_WIDTH_SPACE}DC`)

    expect(result.text).toBe(`US${HIDDEN_MARKER}DC`)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('replaces a byte-order mark', () => {
    expect(toSafeText(`${BYTE_ORDER_MARK}USDC`).hasHiddenCharacters).toBe(true)
  })

  it('replaces a soft hyphen', () => {
    expect(toSafeText(`US${SOFT_HYPHEN}DC`).hasHiddenCharacters).toBe(true)
  })

  it('replaces a newline', () => {
    /* A newline in a token name breaks the list layout and lets a
       neighbouring row be visually faked. */
    const result = toSafeText('USDC\nConfirmed')

    expect(result.text).not.toContain('\n')
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it('a fake stays distinguishable from the genuine string', () => {
    /* The main property: the genuine and fake characters do not
       match on screen. */
    const genuine = toSafeText('USDC')
    const forged = toSafeText(`USD${ZERO_WIDTH_SPACE}C`)

    expect(forged.text).not.toBe(genuine.text)
  })

  it('several hidden characters are each replaced', () => {
    const result = toSafeText(`${ZERO_WIDTH_SPACE}US${ZERO_WIDTH_SPACE}DC`)

    expect(result.text).toBe(`${HIDDEN_MARKER}US${HIDDEN_MARKER}DC`)
  })
})

describe('toSafeText: length', () => {
  it('truncates an overly long string', () => {
    /* A long name pushes the amount and address off the screen —
       the reason the user looks at the row. */
    const result = toSafeText('\u0430'.repeat(200))

    expect(result.isTruncated).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(65)
    expect(result.text.endsWith('…')).toBe(true)
  })

  it('does not truncate a string on the boundary', () => {
    const result = toSafeText('\u0430'.repeat(64))

    expect(result.isTruncated).toBe(false)
  })
})

describe('safeText', () => {
  it('returns only the text', () => {
    expect(safeText(`USDC${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(`USDC${HIDDEN_MARKER}`)
  })

  it('an empty string stays empty', () => {
    expect(safeText('')).toBe('')
  })
})

describe('Mixed scripts', () => {
  it('Latin with Cyrillic inside a word is flagged', () => {
    /* `Aave` with a Cyrillic A (U+0410) looks flawless: no hidden
       characters, ordinary visible letters. */
    expect(toSafeText('\u0410ave').hasMixedScripts).toBe(true)
  })

  it('a Greek letter in a Latin word is flagged', () => {
    expect(toSafeText('Uniswa\u03c1').hasMixedScripts).toBe(true)
  })

  it('a homogeneous name is not flagged', () => {
    expect(toSafeText('Uniswap').hasMixedScripts).toBe(false)
    expect(toSafeText('\u041A\u043E\u0448\u0435\u043B\u0451\u043A').hasMixedScripts).toBe(false)
  })

  it('a bilingual string of separate words is not flagged', () => {
    /* Mixing is counted per word: "Aave — Loans" is ordinary text,
       not a fake. A false alarm trains people to ignore warnings. */
    expect(toSafeText('Aave — \u0417\u0430\u0439\u043C\u044B').hasMixedScripts).toBe(false)
  })

  it('digits and signs do not form a script', () => {
    expect(toSafeText('USDC-2').hasMixedScripts).toBe(false)
    expect(toSafeText('1inch').hasMixedScripts).toBe(false)
  })

  it('the flag is distinct from hidden characters', () => {
    /* Different flags need different explanations: in one case the
       string holds something invisible, in the other everything is
       visible but not from that alphabet. */
    const mixed = toSafeText('\u0410ave')

    expect(mixed.hasMixedScripts).toBe(true)
    expect(mixed.hasHiddenCharacters).toBe(false)
  })
})
