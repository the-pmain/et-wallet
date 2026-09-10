import { describe, expect, it } from 'vitest'

import { normalizeEnsName, toSafeText, safeText } from '@/core'

/**
 * Dangerous characters are built from code points, not written as
 * literals.
 *
 * An invisible character inside a source-code string cannot be seen
 * when reading — exactly why it is dangerous in displayed text.
 */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const SOFT_HYPHEN = String.fromCodePoint(0x00ad)
const CYRILLIC_A = String.fromCodePoint(0x0430)

describe('Sanitizing text from contracts and third-party services', () => {
  it('does not let a direction override reach the screen', () => {
    /* U+202E shows text backwards: that is how token symbols and
       network names are spoofed. */
    const result = toSafeText(`USD${RIGHT_TO_LEFT_OVERRIDE}C`)

    expect(result.text).not.toContain(RIGHT_TO_LEFT_OVERRIDE)
    expect(result.hasHiddenCharacters).toBe(true)
  })

  it.each([
    ['zero-width space', ZERO_WIDTH_SPACE],
    ['soft hyphen', SOFT_HYPHEN],
  ])('marks an invisible character (%s) instead of deleting it silently', (_name, character) => {
    /* Deleting the invisible would make a spoof indistinguishable
       from the original — exactly what the contract author wanted. */
    const result = toSafeText(`USD${character}C`)

    expect(result.hasHiddenCharacters).toBe(true)
    expect(result.text).not.toBe('USDC')
  })

  it('does not let a newline break the next list row', () => {
    const result = toSafeText('USDC\nConfirmed')

    expect(result.text).not.toContain('\n')
  })

  it('does not let a long name push the amount off the screen', () => {
    /* A contract author may name a token anything; they have no
       right to occupy the whole screen with it. */
    const result = toSafeText('A'.repeat(500))

    expect(result.isTruncated).toBe(true)
    expect(result.text.length).toBeLessThan(100)
  })

  it('leaves ordinary text unchanged', () => {
    /* False positives train people not to read warnings. */
    const result = toSafeText('Tether USD')

    expect(result.text).toBe('Tether USD')
    expect(result.hasHiddenCharacters).toBe(false)
    expect(result.isTruncated).toBe(false)
  })

  it('the short form yields the same text', () => {
    expect(safeText(`USD${ZERO_WIDTH_SPACE}C`)).toBe(toSafeText(`USD${ZERO_WIDTH_SPACE}C`).text)
  })

  it('markup stays text and does not become markup', () => {
    /* React escapes on its own; the check locks that sanitizing
       does not turn the string into something executable. */
    const payload = '<img src=x onerror=alert(1)>'

    expect(toSafeText(payload).text).toBe(payload)
  })
})

describe('ENS names: a spoof does not reach the user', () => {
  it('rejects mixed scripts inside a label', () => {
    const spoofed = `vit${CYRILLIC_A}lik.eth`

    expect(spoofed).not.toBe('vitalik.eth')
    expect(normalizeEnsName(spoofed)).toBeNull()
  })

  it('does not let an invisible character create a second name', () => {
    /* Both records must hash to one node: otherwise they would
       point at different recipients while looking the same. */
    expect(normalizeEnsName(`vitalik${ZERO_WIDTH_SPACE}.eth`)).toBe(normalizeEnsName('vitalik.eth'))
  })

  it('rejects punycode', () => {
    /* An `xn--` label is hashed as-is and is expanded to Unicode
       somewhere else. */
    expect(normalizeEnsName('xn--80ak6aa92e.eth')).toBeNull()
  })

  it('does not treat a TLD as a recipient', () => {
    expect(normalizeEnsName('eth')).toBeNull()
  })
})
