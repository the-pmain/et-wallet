/**
 * Brings a typed phrase to canonical form.
 *
 * What is done and why:
 *
 * 1. **NFKD normalisation.** A BIP-39 requirement. Visually identical
 *    characters can have different Unicode representations; without
 *    normalisation a phrase copied from another app will fail the
 *    check.
 *
 * 2. **Removal of invisible characters.** Copying from PDFs and web
 *    pages brings soft hyphens, zero-width characters, and bidi
 *    marks. The user does not see them, and the wordlist comparison
 *    fails.
 *
 * 3. **Collapsing whitespace.** Newlines, tabs, and double spaces
 *    appear when typing from a column or a table.
 *
 * 4. **Lower-casing.** The English BIP-39 wordlist is entirely
 *    lower-case, and mobile keyboards automatically capitalise the
 *    first letter. For the English wordlist the conversion is
 *    unambiguous and safe.
 *
 * Normalisation does NOT weaken the check: the checksum is computed
 * from wordlist indexes, and a word still missing after
 * normalisation is still rejected.
 */

/**
 * Invisible characters to remove.
 *
 * Written as escape sequences on purpose: an invisible character in
 * source cannot be checked in review, and the ESLint rule
 * `no-irregular-whitespace` forbids it.
 *
 * U+00AD SOFT HYPHEN, U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
 * U+200E LRM, U+200F RLM, U+2060 WORD JOINER, U+FEFF BOM.
 */
const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g

/**
 * Any run of whitespace.
 *
 * The `\s` class in JavaScript already includes the non-breaking
 * space U+00A0 and the ideographic space U+3000, so listing them
 * separately is unnecessary.
 */
const WHITESPACE_RUN = /\s+/g

export function normalizeMnemonicInput(input: string): string {
  return input
    .normalize('NFKD')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Splits a normalised phrase into words.
 *
 * An empty string yields an empty array, not an array of one empty
 * string: otherwise empty input would look like a one-word phrase.
 */
export function splitWords(normalized: string): readonly string[] {
  return normalized.length === 0 ? [] : normalized.split(' ')
}
