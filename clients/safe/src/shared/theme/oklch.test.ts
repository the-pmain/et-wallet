import { describe, expect, it } from 'vitest'

import { hexToOklch, parseHexColor } from './oklch'

describe('parseHexColor', () => {
  it('accepts a full hex and uppercases it', () => {
    expect(parseHexColor('#3a3a40')).toBe('#3A3A40')
  })

  it('expands a short hex', () => {
    expect(parseHexColor('#abc')).toBe('#AABBCC')
  })

  it('rejects a non-hex string', () => {
    expect(parseHexColor('purple')).toBeNull()
    expect(parseHexColor('#12')).toBeNull()
  })
})

describe('hexToOklch', () => {
  it('reads graphite as a near-neutral dark gray', () => {
    const color = hexToOklch('#3A3A40')

    expect(color).not.toBeNull()
    expect(color?.l).toBeGreaterThan(0.25)
    expect(color?.l).toBeLessThan(0.4)
    expect(color?.c).toBeLessThan(0.04)
  })

  it('reads violet as a saturated purple', () => {
    const color = hexToOklch('#6D28D9')

    expect(color).not.toBeNull()
    expect(color?.c).toBeGreaterThan(0.15)
    expect(color?.h).toBeGreaterThan(280)
    expect(color?.h).toBeLessThan(320)
  })

  it('returns null for garbage', () => {
    expect(hexToOklch('not-a-color')).toBeNull()
  })
})
