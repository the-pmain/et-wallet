import { WeakPasswordError } from '@/core/errors'

/**
 * Minimum password length.
 *
 * There is no complexity rule: the user may set `123456`. Only an empty
 * value is rejected — the server `the_p` column also requires at least
 * one character. Local-vault strength still rests on KDF cost, not on
 * composition rules.
 */
export const MIN_PASSWORD_LENGTH = 1

/**
 * Upper length bound.
 *
 * Not a security limit: PBKDF2 hashes a password of any length. The
 * cap guards against accidentally pasting megabytes of text, whose
 * key derivation would freeze the UI.
 */
export const MAX_PASSWORD_LENGTH = 256

/**
 * Most common passwords.
 *
 * The list is deliberately short. A full breach-dictionary check would
 * need tens of megabytes loaded or a call to an external service —
 * the latter is unacceptable for a wallet: sending even a password
 * hash outside ties the user to their wallet.
 *
 * Only variants that any attack tries in the first seconds are cut.
 *
 * THE LIST WAS REWRITTEN WHEN THE MINIMUM LENGTH DROPPED. Old entries
 * were twelve characters or more — matching the old floor — and
 * `Qwerty12` was not caught at all. Entries are now short: matching
 * is by substring, so the root `qwerty` covers both `Qwerty12` and
 * `qwerty123456`.
 *
 * More than half of common passwords are cut not by this list but by
 * the three-class requirement: `12345678` and `football` fail it
 * regardless of the dictionary.
 */
const COMMON_PASSWORDS: readonly string[] = [
  'password',
  'passw0rd',
  'qwerty',
  'abc123',
  'iloveyou',
  'letmein',
  'trustno1',
  'welcome',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'starwars',
  'administrator',
]

/** Character classes counted in the assessment. */
export const CHARACTER_CLASS = {
  Lowercase: 'lowercase',
  Uppercase: 'uppercase',
  Digit: 'digit',
  Symbol: 'symbol',
} as const

export type CharacterClass = (typeof CHARACTER_CLASS)[keyof typeof CHARACTER_CLASS]

export const PASSWORD_ISSUE = {
  TooShort: 'too-short',
  TooLong: 'too-long',
  TooFewClasses: 'too-few-classes',
  Common: 'common',
  Repetitive: 'repetitive',
} as const

export type PasswordIssue = (typeof PASSWORD_ISSUE)[keyof typeof PASSWORD_ISSUE]

export const PASSWORD_STRENGTH = {
  Weak: 'weak',
  Fair: 'fair',
  Strong: 'strong',
} as const

export type PasswordStrength = (typeof PASSWORD_STRENGTH)[keyof typeof PASSWORD_STRENGTH]

export interface IPasswordAssessment {
  readonly isAcceptable: boolean
  readonly strength: PasswordStrength
  readonly issues: readonly PasswordIssue[]
  readonly presentClasses: readonly CharacterClass[]
}

const MIN_CHARACTER_CLASSES = 3

const STRONG_PASSWORD_LENGTH = 16

/**
 * Assesses a password without throwing.
 *
 * Meant for a hint while typing: the user must not see an error before
 * they have finished.
 *
 * WHAT THIS ASSESSMENT DOES NOT DO. It does not measure entropy and
 * does not replace a breach-dictionary check. `Tr0ub4dor&3` passes every
 * rule and is still guessed from a dictionary in minutes. The rules
 * cut the obviously bad; they do not prove the password is good — the
 * UI must not promise the opposite with the word "strong" without
 * caveats.
 */
export function assessPassword(password: string): IPasswordAssessment {
  const issues: PasswordIssue[] = []
  const presentClasses = detectCharacterClasses(password)

  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(PASSWORD_ISSUE.TooShort)
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    issues.push(PASSWORD_ISSUE.TooLong)
  }

  if (presentClasses.length < MIN_CHARACTER_CLASSES) {
    issues.push(PASSWORD_ISSUE.TooFewClasses)
  }

  if (isCommon(password)) {
    issues.push(PASSWORD_ISSUE.Common)
  }

  if (isRepetitive(password)) {
    issues.push(PASSWORD_ISSUE.Repetitive)
  }

  return {
    isAcceptable: isLengthAcceptable(password),
    strength: gradeStrength(password, presentClasses, issues),
    issues,
    presentClasses,
  }
}

/**
 * Checks the password before wallet creation.
 *
 * Composition is not checked: `123456` is allowed. An empty password
 * and a value over the upper bound are rejected.
 *
 * @throws WeakPasswordError
 */
export function assertAcceptablePassword(password: string): void {
  if (!isLengthAcceptable(password)) {
    const assessment = assessPassword(password)
    throw new WeakPasswordError(assessment.issues.join(', '))
  }
}

function isLengthAcceptable(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
}

function detectCharacterClasses(password: string): readonly CharacterClass[] {
  const classes: CharacterClass[] = []

  if (/\p{Ll}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Lowercase)
  }

  if (/\p{Lu}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Uppercase)
  }

  if (/\p{Nd}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Digit)
  }

  if (/[^\p{L}\p{Nd}]/u.test(password)) {
    classes.push(CHARACTER_CLASS.Symbol)
  }

  return classes
}

function isCommon(password: string): boolean {
  const normalized = password.toLowerCase()

  return COMMON_PASSWORDS.some((candidate) => normalized.includes(candidate))
}

/**
 * Detects a password made of a repeated fragment.
 *
 * `abcabcabcabc` formally meets the length, but is guessed as a
 * four-character secret.
 */
function isRepetitive(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return false
  }

  for (let size = 1; size <= password.length / 2; size += 1) {
    if (password.length % size !== 0) {
      continue
    }

    const fragment = password.slice(0, size)

    if (fragment.repeat(password.length / size) === password) {
      return true
    }
  }

  return false
}

function gradeStrength(
  password: string,
  presentClasses: readonly CharacterClass[],
  issues: readonly PasswordIssue[],
): PasswordStrength {
  if (issues.length > 0) {
    return PASSWORD_STRENGTH.Weak
  }

  if (password.length >= STRONG_PASSWORD_LENGTH && presentClasses.length === 4) {
    return PASSWORD_STRENGTH.Strong
  }

  return PASSWORD_STRENGTH.Fair
}
