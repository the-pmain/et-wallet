import { describe, expect, it } from 'vitest'

import { beautifyEnsName, isAsciiEnsName, looksLikeEnsName, normalizeEnsName } from './ens-name'

/**
 * Substitution characters are built from codes, not written as literals.
 *
 * A Cyrillic a (U+0430) is indistinguishable from a Latin one on screen, and
 * a zero-width space is invisible altogether. Written directly in a
 * string they would make this test unverifiable by reading — for the
 * same reason they are dangerous inside a name.
 */
const CYRILLIC_A = String.fromCodePoint(0x0430)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const LATIN_V = 'v'

describe('looksLikeEnsName', () => {
  it.each(['vitalik.eth', 'a.b.eth', ' shop.eth '])('treats "%s" as a name', (value) => {
    expect(looksLikeEnsName(value)).toBe(true)
  })

  it.each(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'vitalik', '', 'vitalik.', '0x'])(
    'does not treat "%s" as a name',
    (value) => {
      expect(looksLikeEnsName(value)).toBe(false)
    },
  )
})

describe('normalizeEnsName: what is accepted', () => {
  it('strips case and edge spaces', () => {
    expect(normalizeEnsName('  Vitalik.ETH ')).toBe('vitalik.eth')
  })

  it.each(['vitalik.eth', 'my-shop.eth', 'a1.b2.eth', '123.eth'])('accepts "%s"', (value) => {
    expect(normalizeEnsName(value)).toBe(value)
  })

  it.each(['-shop.eth', 'shop-.eth'])('accepts a hyphen at a label edge: "%s"', (value) => {
    /* DNS forbids this, ENSIP-15 does not. A check stricter than
       the standard would refuse to send to an existing name. */
    expect(normalizeEnsName(value)).toBe(value)
  })

  it('accepts a name written entirely in Cyrillic', () => {
    expect(normalizeEnsName('\u041F\u0420\u0418\u0412\u0415\u0422.eth')).toBe(
      '\u043F\u0440\u0438\u0432\u0435\u0442.eth',
    )
  })

  it('accepts emoji', () => {
    expect(normalizeEnsName('\u{1F600}.eth')).toBe('\u{1F600}.eth')
  })

  it('brings diacritics to canonical form', () => {
    expect(normalizeEnsName('ÅNGSTRÖM.eth')).toBe('ångström.eth')
  })
})

describe('normalizeEnsName: what is rejected', () => {
  it('rejects mixed scripts inside a label', () => {
    /* The main ENSIP-15 defence. On screen the name is
       indistinguishable from `vitalik.eth`, but the node is
       different — and therefore so is the recipient. */
    const spoofed = `vit${CYRILLIC_A}lik.eth`

    expect(spoofed).not.toBe('vitalik.eth')
    expect(normalizeEnsName(spoofed)).toBeNull()
  })

  it('rejects mixed scripts the other way', () => {
    expect(normalizeEnsName(`\u043F\u0440\u0438${LATIN_V}\u0435\u0442.eth`)).toBeNull()
  })

  it('rejects punycode', () => {
    /* An `xn--` label is hashed as-is and unfolded to Unicode
       somewhere else: two writings of one name would yield different
       nodes. */
    expect(normalizeEnsName('xn--80ak6aa92e.eth')).toBeNull()
  })

  it('rejects an empty label', () => {
    expect(normalizeEnsName('a..eth')).toBeNull()
  })

  it('rejects a single-label name', () => {
    /* `eth` passes normalisation: it is a legal label. But a
       top-level domain cannot be a recipient, and that is our
       check, not the standard's. */
    expect(normalizeEnsName('eth')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(normalizeEnsName('   ')).toBeNull()
  })

  it('rejects a name that is too long', () => {
    const name = `${Array.from({ length: 32 }, () => 'abcdefgh').join('.')}.eth`

    expect(name.length).toBeGreaterThan(255)
    expect(normalizeEnsName(name)).toBeNull()
  })
})

describe('normalizeEnsName: invisible characters', () => {
  it('an invisible character does not create a second name', () => {
    /* ENSIP-15 treats a zero-width space as ignored: it is
       stripped, not rejected. What matters is not which way, but
       that a forgery is impossible — both writings yield ONE name
       and therefore one address. */
    const withHidden = `vitalik${ZERO_WIDTH_SPACE}.eth`

    expect(withHidden).not.toBe('vitalik.eth')
    expect(normalizeEnsName(withHidden)).toBe('vitalik.eth')
    expect(normalizeEnsName(withHidden)).toBe(normalizeEnsName('vitalik.eth'))
  })
})

describe('beautifyEnsName', () => {
  it('leaves an ordinary name unchanged', () => {
    expect(beautifyEnsName('vitalik.eth')).toBe('vitalik.eth')
  })

  it('returns emoji in the colour form', () => {
    /* Normalisation strips the variation selector so the node is
       unique; on screen the emoji should look familiar. */
    const normalized = normalizeEnsName('\u{1F600}.eth')

    expect(normalized).not.toBeNull()
    expect(beautifyEnsName(normalized as string)).toBe('\u{1F600}\u{FE0F}.eth')
  })
})

describe('isAsciiEnsName', () => {
  it('treats a Latin name as ASCII', () => {
    expect(isAsciiEnsName('vitalik.eth')).toBe(true)
  })

  it.each(['\u043F\u0440\u0438\u0432\u0435\u0442.eth', 'ångström.eth', '\u{1F600}.eth'])(
    'does not treat "%s" as ASCII',
    (value) => {
      expect(isAsciiEnsName(value)).toBe(false)
    },
  )
})
