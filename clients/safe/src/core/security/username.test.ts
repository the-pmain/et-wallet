import { describe, expect, it } from 'vitest'

import {
  MAX_USERNAME_LENGTH,
  areUsernamesEqual,
  isValidUsername,
  normalizeUsername,
} from './username'

/** Characters that must not appear in a name — given as code points. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const NEWLINE = String.fromCodePoint(0x000a)

/* Cyrillic fixtures as escapes: the source must hold no raw letters. */
const DMITRY = '\u0414\u043C\u0438\u0442\u0440\u0438\u0439'
const DMITRY_INNER_CAP = '\u0414\u041C\u0438\u0442\u0440\u0438\u0439'
const DMITRY_LOWER = '\u0434\u043C\u0438\u0442\u0440\u0438\u0439'
const IVANOV = '\u0418\u0432\u0430\u043D\u043E\u0432'
const MARIA = '\u041C\u0430\u0440\u0438\u044F'
const MARIA_PETROVA = '\u041C\u0430\u0440\u0438\u044F \u041F\u0435\u0442\u0440\u043E\u0432\u0430'
const LI = '\u041B\u0438'
const CYRILLIC_DE = '\u0414'
const CYRILLIC_A = '\u0430'

describe('Name normalisation', () => {
  it('strips edge spaces', () => {
    expect(normalizeUsername(`  ${DMITRY}  `)).toBe(DMITRY)
  })

  it('collapses repeated spaces', () => {
    /* "Dmitry  Ivanov" and "Dmitry Ivanov" are the same name,
       and the difference in the UI would look like a typo. */
    expect(normalizeUsername(`${DMITRY}   ${IVANOV}`)).toBe(`${DMITRY} ${IVANOV}`)
  })

  it('preserves case', () => {
    /* This is a display name: lowercasing "Dmitry" would show the
       owner something other than what they typed. */
    expect(normalizeUsername(DMITRY_INNER_CAP)).toBe(DMITRY_INNER_CAP)
  })
})

describe('Name acceptability', () => {
  it.each([DMITRY, 'Alex', MARIA_PETROVA, 'user_42', LI, '大明'])(
    'accepts "%s"',
    (name) => {
      /* The character set is not restricted: a wallet has no right
         to forbid people from being called what they are called. */
      expect(isValidUsername(name)).toBe(true)
    },
  )

  it('rejects an empty value', () => {
    expect(isValidUsername('')).toBe(false)
    expect(isValidUsername('   ')).toBe(false)
  })

  it('rejects a one-character name', () => {
    /* A one-letter wallet label distinguishes it from nothing. */
    expect(isValidUsername(CYRILLIC_DE)).toBe(false)
  })

  it('rejects an overly long name', () => {
    /* A long name would push the address off the transaction
       confirmation row — hiding where the funds go. */
    expect(isValidUsername(CYRILLIC_A.repeat(MAX_USERNAME_LENGTH + 1))).toBe(false)
  })

  it('accepts a name of exactly the limit length', () => {
    expect(isValidUsername(CYRILLIC_A.repeat(MAX_USERNAME_LENGTH))).toBe(true)
  })

  it('a newline becomes a space, not a rejection', () => {
    /* It breaks the account-list layout, but rejecting the name for
       it is unnecessary: a paste with a newline is an ordinary
       accident, and fixing it is better than forcing a rewrite. */
    expect(isValidUsername(`${DMITRY}${NEWLINE}${IVANOV}`)).toBe(true)
    expect(normalizeUsername(`${DMITRY}${NEWLINE}${IVANOV}`)).toBe(`${DMITRY} ${IVANOV}`)
  })

  it('rejects a non-printable control character', () => {
    /* Unlike a newline, it is not whitespace: it cannot be turned
       into anything meaningful, and it does not belong in a name. */
    expect(isValidUsername(`${DMITRY}${String.fromCodePoint(0x0007)}`)).toBe(false)
  })

  it('rejects a zero-width character', () => {
    /* Two visually identical names fake labels the same way
       addresses and ENS names are faked. */
    expect(isValidUsername(`${DMITRY}${ZERO_WIDTH_SPACE}`)).toBe(false)
  })

  it('rejects a writing-direction override', () => {
    /* They reorder visible characters without changing the string. */
    expect(isValidUsername(`${DMITRY}${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(false)
  })
})

describe('Name comparison', () => {
  it('does not distinguish case', () => {
    expect(areUsernamesEqual(DMITRY, DMITRY_LOWER)).toBe(true)
  })

  it('does not distinguish extra spaces', () => {
    expect(areUsernamesEqual(` ${DMITRY}  ${IVANOV} `, `${DMITRY} ${IVANOV}`)).toBe(true)
  })

  it('distinguishes different names', () => {
    expect(areUsernamesEqual(DMITRY, MARIA)).toBe(false)
  })
})
