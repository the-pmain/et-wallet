/**
 * Reducing a name to a "skeleton" — the form in which names that
 * look the same to the eye coincide.
 *
 * WHY. Byte-for-byte comparison is bypassed by one letter: `Ethereum`
 * with a Cyrillic e (U+0435) matches the Latin one in no byte, and looks
 * exactly the same. The user sees a familiar name and signs a
 * transfer, thinking it is a send to mainnet.
 *
 * LIVES NEXT TO UNTRUSTED-STRING DISPLAY, NOT IN THE NETWORK MODULE.
 * The technique is the same for a network name, a token symbol, and
 * an app name; two implementations of one comparison would drift,
 * and they would drift in silence — toward weakening the one that
 * was forgotten.
 *
 * WHAT IS NOT IMPLEMENTED HERE. The full UTS #39 algorithm with the
 * Unicode confusable table: it has thousands of entries and weighs
 * more than the whole wallet network layer. A subset is taken, the
 * one used for impersonation in practice — Cyrillic, Greek, Armenian
 * letters and digits that look like Latin. The limit is named in the
 * debt list, not passed off as completeness.
 *
 * STEP ORDER MATTERS. NFKD first: it itself maps mathematical
 * letterforms (`𝐄𝐭𝐡𝐞𝐫𝐞𝐮𝐦`), fullwidth forms, and letters with
 * diacritics to Latin. The table below covers what NFKD cannot cover
 * in principle: these are different letters of different alphabets,
 * not variants of one.
 */

/**
 * Invisible characters.
 *
 * Written as escape sequences: an invisible character in source
 * cannot be checked when reading.
 *
 * U+00AD SOFT HYPHEN, U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
 * U+200E LRM, U+200F RLM, U+2060 WORD JOINER, U+FEFF BOM.
 */
const INVISIBLE = new RegExp('[\xad\u200b-\u200f\u2060\ufeff]', 'gu')

/** Combining marks separated by NFKD normalization. */
const COMBINING_MARKS = /\p{M}/gu

/**
 * Everything that is not a letter or a digit.
 *
 * Removed wholesale: `E-thereum`, `E thereum`, and `Ethereum` are
 * the same name to the eye, and a defense that a hyphen bypasses is
 * useless.
 */
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]/gu

/**
 * Letters indistinguishable from Latin.
 *
 * Each row is "what they substitute" → "what they substitute with".
 * Keys are lowercase: case folding runs before substitution, so
 * uppercase variants need not be listed.
 *
 * DIGITS ARE INCLUDED ON PURPOSE: `0ptimism` and `P0lygon` are the
 * same substitution done with ASCII, and it does not depend on the
 * Unicode table. A false positive would require a name that differs
 * from the built-in only by a digit in place of a letter — i.e.
 * exactly a substitution.
 */
const CONFUSABLE_LETTERS: ReadonlyMap<string, string> = new Map([
  /* Cyrillic. Keys are escapes so the source holds no raw letters. */
  ['\u0430', 'a'],
  ['\u0432', 'b'],
  ['\u0435', 'e'],
  ['\u0451', 'e'],
  ['\u043A', 'k'],
  ['\u043C', 'm'],
  ['\u043D', 'h'],
  ['\u043E', 'o'],
  ['\u0440', 'p'],
  ['\u0441', 'c'],
  ['\u0442', 't'],
  ['\u0443', 'y'],
  ['\u0445', 'x'],
  ['\u0455', 's'],
  ['\u0456', 'i'],
  ['\u0457', 'i'],
  ['\u0458', 'j'],
  ['\u0501', 'd'],
  ['\u051B', 'q'],
  ['\u051D', 'w'],
  ['\u04BB', 'h'],
  ['\u0475', 'v'],
  ['ց', 'g'],

  /* Greek. */
  ['α', 'a'],
  ['β', 'b'],
  ['γ', 'y'],
  ['ε', 'e'],
  ['ζ', 'z'],
  ['η', 'n'],
  ['ι', 'i'],
  ['κ', 'k'],
  ['ν', 'v'],
  ['ο', 'o'],
  ['ρ', 'p'],
  ['τ', 't'],
  ['υ', 'u'],
  ['χ', 'x'],
  ['ϲ', 'c'],
  ['ϳ', 'j'],

  /* Armenian. */
  ['օ', 'o'],
  ['ս', 'u'],
  ['հ', 'h'],
  ['ո', 'n'],
  ['ր', 'r'],
  ['բ', 'p'],

  /* Latin letters indistinguishable from each other. One
     representative per group, so `l` and `i` collapse to one
     character. */
  ['l', 'i'],

  /* Digits. */
  ['0', 'o'],
  ['1', 'i'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
])

/**
 * Reduces a name to the form in which visually identical names coincide.
 *
 * The operation is irreversible and is ONLY FOR COMPARISON. The
 * result must not be shown to the user: `Polygon` becomes `poiygon`,
 * and seeing that would confuse them.
 */
export function toNameSkeleton(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(INVISIBLE, '')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, '')

  let skeleton = ''

  for (const character of normalized) {
    skeleton += CONFUSABLE_LETTERS.get(character) ?? character
  }

  return skeleton
}

/**
 * Name characters that are not Latin or digits.
 *
 * SHOWN TO THE USER. On a lookalike-letter substitution a person
 * sees two visually identical names and a "name is taken" message —
 * without an explanation it looks like a wallet bug. A list of
 * foreign letters turns the unexplained into the obvious.
 *
 * Duplicates are dropped: the same letter seen three times adds
 * nothing to the explanation.
 */
export function findForeignCharacters(name: string): readonly string[] {
  const found = new Set<string>()

  for (const character of name.normalize('NFKD').replace(COMBINING_MARKS, '')) {
    if (!/[\p{L}\p{N}]/u.test(character)) {
      continue
    }

    if (!/[a-zA-Z0-9]/u.test(character)) {
      found.add(character)
    }
  }

  return [...found]
}
