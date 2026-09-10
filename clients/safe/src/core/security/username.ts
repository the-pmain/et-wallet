/**
 * Username — the wallet's label in the UI.
 *
 * THIS IS A LABEL, NOT AN ACCOUNT. The wallet is non-custodial: there
 * is no server that would check a name/password pair, and there must
 * not be one. The name is stored encrypted on the device and labels
 * the wallet instead of a faceless "Account 1".
 *
 * WHAT IT DOES NOT GIVE. No access recovery, no second factor, no
 * support to write to: there is nobody to write to. The UI must say
 * this plainly, or the owner will assume a forgotten password can be
 * recovered by name and lose funds.
 *
 * WHY NOT EMAIL. An email address looks like an account: someone
 * entering it at wallet creation reasonably expects a recovery mail —
 * and none will come. Email also reveals the owner's identity to
 * whoever has the device, giving nothing back: the check runs after
 * the vault is decrypted and adds no guessing resistance.
 */

export const MIN_USERNAME_LENGTH = 2

/**
 * Maximum name length.
 *
 * Matches the account-name limit: the name becomes the first account's
 * label, and a longer value would have to be truncated on save.
 */
export const MAX_USERNAME_LENGTH = 32

/**
 * Control characters and invisible separators.
 *
 * WHY THEY ARE FORBIDDEN. A newline breaks the account-list layout,
 * and invisible characters let two names look the same — the trick
 * used to fake addresses and ENS names. The owner sets the name here,
 * but it goes into a backup, and a backup may come from outside.
 */
const FORBIDDEN_PATTERN = new RegExp(
  [
    /* Control characters: newline, carriage return, tab. */
    '[\u0000-\u001f\u007f-\u009f]',
    /* Zero-width: word joiners and separators. */
    '[\u200b-\u200f\u2060\ufeff]',
    /* Bidi controls: they reorder what is visible. */
    '[\u202a-\u202e\u2066-\u2069]',
  ].join('|'),
  'u',
)

/**
 * Normalises a name for storage.
 *
 * Edge spaces are stripped, repeats inside collapse: "James  Smith"
 * and "James Smith" are the same name, and the difference in the UI
 * would look like a typo.
 *
 * NEWLINES AND TABS LAND HERE TOO: they are whitespace and become a
 * regular space. Rejecting a name because a paste brought a newline
 * would force a rewrite where a fix is enough.
 *
 * CASE IS PRESERVED. This is a display name: lowercasing "James" would
 * show the owner something other than what they typed.
 */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

/**
 * Whether the name is acceptable.
 *
 * THE CHECK IS DELIBERATELY SOFT. The name is not sent anywhere and
 * is not matched against anything; restricting its character set would
 * forbid people from being called what they are called. Only what
 * breaks the UI or enables a fake is rejected: control characters,
 * invisible separators, empty and overly long values.
 */
export function isValidUsername(value: string): boolean {
  const normalized = normalizeUsername(value)

  if (normalized.length < MIN_USERNAME_LENGTH || normalized.length > MAX_USERNAME_LENGTH) {
    return false
  }

  return !FORBIDDEN_PATTERN.test(normalized)
}

/**
 * Whether two names match.
 *
 * Compared in normalised form, case-insensitive: the difference
 * between "James" and "james" does not exist for a person.
 */
export function areUsernamesEqual(left: string, right: string): boolean {
  return normalizeUsername(left).toLowerCase() === normalizeUsername(right).toLowerCase()
}
