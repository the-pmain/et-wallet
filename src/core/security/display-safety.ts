/**
 * Neutralizing untrusted text before display.
 *
 * WHERE UNTRUSTED TEXT COMES FROM. A token symbol and name are set by
 * the contract author. A network name and explorer URL are set by
 * whoever added the network. A system-notification text comes from a
 * reference service. None of these strings is written by us, and all
 * of them are shown next to amounts and addresses.
 *
 * WHY THIS IS DANGEROUS IF REACT ALREADY ESCAPES MARKUP. The danger
 * is not markup. Unicode can reverse writing direction and insert
 * invisible characters: override U+202E shows text backwards, and
 * zero-width space U+200B makes two different strings look the same.
 * That is how tokens and addresses are faked in wallet UIs.
 *
 * MAIN DECISION: HIDDEN CHARACTERS ARE NOT DELETED IN SILENCE.
 * Deleting an invisible would make the fake indistinguishable from
 * the original — exactly what the contract author wanted. The
 * character is replaced with a visible marker, and the string is
 * marked as having contained hidden content so the UI can show a
 * warning.
 *
 * CODES ARE WRITTEN EXPLICITLY, NOT AS THE CHARACTERS THEMSELVES.
 * An invisible character inside a regular expression cannot be seen
 * when reading the code, and that form is unverifiable for the same
 * reason it is dangerous.
 */

/**
 * Characters that change writing direction.
 *
 * U+202A–U+202E — deprecated embeddings and overrides,
 * U+2066–U+2069 — isolates. Both allow showing text in an order
 * different from the order of characters in the string.
 */
const BIDIRECTIONAL_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu

/**
 * Invisible characters.
 *
 * U+200B–U+200F — zero-width space, joiners, and direction marks;
 * U+2060–U+2064 — word joiners; U+FEFF — byte-order mark; U+00AD —
 * soft hyphen. None is needed in a token symbol or network name, and
 * any of them allows issuing a visually identical string.
 */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/gu

/**
 * Control characters.
 *
 * Line feed and carriage return break list layout and allow visually
 * faking the neighbouring line.
 */
/* Control characters in the expression are exactly what is searched
   for. The rule warns about them landing in a pattern by accident;
   here they are intentional. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/gu

/** Marker shown in place of a hidden character. */
const HIDDEN_MARKER = '\uFFFD'

/**
 * Cap on displayed-string length.
 *
 * A long name pushes off the screen what the user is looking at the
 * row for — the amount and the address. The contract author may name
 * a token however they like; they do not have the right to occupy
 * the whole screen with it.
 */
const MAX_DISPLAY_LENGTH = 64

/** Result of neutralization. */
export interface ISafeText {
  /** Text fit to display. */
  readonly text: string

  /**
   * The original string had hidden or control characters.
   *
   * The UI must show this to the user: a string that looks familiar
   * but contained invisibles is a sign of a fake.
   */
  readonly hasHiddenCharacters: boolean

  /** The string was truncated by length. */
  readonly isTruncated: boolean

  /**
   * Scripts are mixed inside one word.
   *
   * A SIGN OF A FAKE THAT NEEDS NO REFERENCE. A network name is
   * compared with built-ins, a token symbol with a verified list;
   * an app name has nothing to compare against — nobody attested it.
   * But a word where Latin sits next to Cyrillic is never legitimate:
   * that is how `Aave` with a Cyrillic A (U+0410) and `USDC` with a
   * Cyrillic C (U+0421) are written, not real names.
   *
   * COUNTED PER WORD. The string "Aave — Loans" mixes scripts, but
   * in different words, and that is ordinary bilingual text. An
   * alarm on it would be a false positive, and false positives teach
   * people not to read warnings.
   */
  readonly hasMixedScripts: boolean
}

/**
 * Prepares an untrusted string for display.
 *
 * @param value A string from a contract, from network config, or
 *        from a third-party service.
 */
export function toSafeText(value: string): ISafeText {
  const replaced = value
    .replace(BIDIRECTIONAL_CONTROLS, HIDDEN_MARKER)
    .replace(INVISIBLE_CHARACTERS, HIDDEN_MARKER)
    .replace(CONTROL_CHARACTERS, HIDDEN_MARKER)

  const hasHiddenCharacters = replaced !== value

  /* Spaces are collapsed after replacement, not before: otherwise a
     control character that already became a marker would merge with
     a neighbouring space and the fake marker would vanish from the
     shown string. */
  const collapsed = replaced.replace(/\s+/gu, ' ').trim()

  const isTruncated = collapsed.length > MAX_DISPLAY_LENGTH

  return {
    text: isTruncated ? `${collapsed.slice(0, MAX_DISPLAY_LENGTH)}…` : collapsed,
    hasHiddenCharacters,
    isTruncated,
    hasMixedScripts: hasMixedScripts(collapsed),
  }
}

/**
 * Scripts the check distinguishes.
 *
 * Listed are those whose letters are indistinguishable from Latin.
 * A script that looks like Latin in no letter is useless for a fake,
 * and including it would raise alarms on ordinary bilingual text.
 */
const SCRIPTS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'latin', pattern: /\p{Script=Latin}/u },
  { name: 'cyrillic', pattern: /\p{Script=Cyrillic}/u },
  { name: 'greek', pattern: /\p{Script=Greek}/u },
  { name: 'armenian', pattern: /\p{Script=Armenian}/u },
]

/**
 * Whether scripts are mixed inside at least one word.
 *
 * Digits and punctuation have no script and are ignored: `USDC-2` is
 * not a mix.
 */
function hasMixedScripts(value: string): boolean {
  for (const word of value.split(/[\s\p{P}\p{S}]+/u)) {
    if (word === '') {
      continue
    }

    const found = SCRIPTS.filter((script) => script.pattern.test(word))

    if (found.length > 1) {
      return true
    }
  }

  return false
}

/**
 * Short form for places that do not need the flags.
 *
 * Exists for markup readability: `{safeText(token.symbol)}` instead
 * of unpacking an object where the warning is shown elsewhere on the
 * row anyway.
 */
export function safeText(value: string): string {
  return toSafeText(value).text
}
