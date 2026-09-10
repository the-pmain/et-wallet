import { ens_beautify, ens_normalize } from '@adraffy/ens-normalize'

/**
 * Canonical ENS name form per ENSIP-15.
 *
 * WHY THIS IS A SECURITY QUESTION, NOT A CONVENIENCE ONE. An ENS
 * node is a hash of the name's bytes. A look-alike of `vitalik.eth`
 * whose third letter is a Cyrillic a (U+0430) looks on screen
 * indistinguishable from the Latin spelling, but yields a different
 * node and therefore a different recipient. Funds go to whoever
 * registered the look-alike, and they cannot be returned.
 *
 * WHY A LIBRARY, NOT OUR OWN CODE. ENSIP-15 is UTS-46 plus
 * script-mixing rules, allowed-character tables, a set of
 * ignored marks, and emoji handling with variation selectors.
 * An error in any table is exactly the substitution the
 * standard exists to stop. `@adraffy/ens-normalize` is the
 * reference implementation that ethers and the ENS UI itself
 * rely on.
 *
 * WHAT THE DEFENCE CATCHES, AND WHAT IT DOES NOT. It catches
 * mixed scripts inside a label: `vitalik` with a Cyrillic a (U+0430)
 * is rejected with a reason. It does NOT catch a name written
 * entirely in another script that looks Latin: a run of one
 * script is a legitimate name and cannot be forbidden. Hence
 * {@link isAsciiEnsName} and the caveat in the UI.
 *
 * WHAT WAS ADDED ON TOP OF THE LIBRARY. Three checks of our
 * own that ENSIP-15 does not have, because the standard
 * normalizes labels and does not decide what is fit to be
 * a recipient:
 *
 * 1. At least two labels. `eth` normalizes successfully, but
 *    a top-level domain cannot be a recipient.
 * 2. A length cap. The name also arrives from a reverse record,
 *    i.e. from a third-party contract; hashing an unbounded
 *    string at a stranger's request is unnecessary.
 * 3. Empty input is rejected: the library normalizes it to an
 *    empty string, and the namehash of that is the root of
 *    the whole tree.
 */

/**
 * Name length cap.
 *
 * Our own limit, not an ENS rule. Real names are orders of
 * magnitude shorter; the value was chosen as ample.
 */
const MAX_NAME_LENGTH = 255

/** Fewest labels: name and domain. */
const MIN_LABEL_COUNT = 2

const NON_ASCII = /[^ -~]/u

/**
 * Whether the input looks like an ENS name.
 *
 * Needed to split input: the user types either an address or
 * a name, and talking to the network only makes sense in the
 * second case. The check is deliberately coarse — it answers
 * "what the user meant", not "whether this is fit to resolve".
 */
export function looksLikeEnsName(value: string): boolean {
  const trimmed = value.trim()

  return !trimmed.startsWith('0x') && trimmed.includes('.') && !trimmed.endsWith('.')
}

/**
 * Brings the name to the canonical form — the one that is hashed.
 *
 * @returns The normalized name, or `null` if it fails ENSIP-15
 *          or is not fit to be a recipient.
 */
export function normalizeEnsName(value: string): string | null {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
    return null
  }

  let normalized: string

  try {
    normalized = ens_normalize(trimmed)
  } catch {
    /* The rejection reason contains a fragment of the typed name
       and is not written to the log: the recipient name is who
       the user intends to pay. The UI only needs the fact of
       rejection. */
    return null
  }

  if (normalized === '' || normalized.split('.').length < MIN_LABEL_COUNT) {
    return null
  }

  return normalized
}

/**
 * Prepares a normalized name for display.
 *
 * Differs from the canonical form in emoji handling: normalization
 * strips variation selectors so different writings of one emoji
 * yield one node, but an emoji should be shown in its colour form.
 * The result must not be hashed — it would yield a different node.
 */
export function beautifyEnsName(name: string): string {
  try {
    return ens_beautify(name)
  } catch {
    /* The name already passed normalization, so a failure here
       would mean a discrepancy inside the library. Show the
       canonical form: it is correct, just less ornate. */
    return name
  }
}

/**
 * Whether the name is ASCII-only.
 *
 * WHY THE UI NEEDS THIS. ENSIP-15 forbids mixing scripts inside
 * a label, but not a name written entirely in another script.
 * A Cyrillic name that looks Latin is a legitimate name belonging
 * to someone else. Such names cannot be forbidden; the user can
 * be told this is not Latin and asked to check the address.
 */
export function isAsciiEnsName(name: string): boolean {
  return !NON_ASCII.test(name)
}
