import { afterEach, describe, expect, it } from 'vitest'

import {
  applyAccentColor,
  DEFAULT_ACCENT_HEX,
  normalizeAccentHex,
  resolveAccentTokens,
} from './accent'
import { ACCENT_COLOR_STORAGE_KEY, readAccentColor, writeAccentColor } from './accent-storage'

describe('resolveAccentTokens', () => {
  it('keeps graphite dark on both themes', () => {
    const light = resolveAccentTokens(DEFAULT_ACCENT_HEX, 'light')
    const dark = resolveAccentTokens(DEFAULT_ACCENT_HEX, 'dark')

    expect(light.chroma).toBeLessThan(0.04)
    expect(light.primaryL).toBeLessThan(0.4)
    expect(dark.chroma).toBeLessThan(0.04)
    expect(dark.primaryL).toBeLessThan(0.45)
    expect(dark.emphasisL).toBeGreaterThan(0.7)
  })

  it('lifts a saturated colour on the dark theme so it still reads', () => {
    const light = resolveAccentTokens('#6D28D9', 'light')
    const dark = resolveAccentTokens('#6D28D9', 'dark')

    expect(light.chroma).toBeGreaterThan(0.15)
    expect(dark.chroma).toBeGreaterThan(0.15)
    expect(dark.primaryL).toBeGreaterThan(light.primaryL)
  })
})

describe('accent storage', () => {
  afterEach(() => {
    localStorage.removeItem(ACCENT_COLOR_STORAGE_KEY)
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.style.removeProperty('--brand-hue')
    document.documentElement.style.removeProperty('--brand-chroma')
  })

  it('falls back to graphite when nothing is stored', () => {
    expect(readAccentColor()).toBe(DEFAULT_ACCENT_HEX)
  })

  it('persists a normalized hex', () => {
    expect(writeAccentColor('#1d4ed8')).toBe('#1D4ED8')
    expect(readAccentColor()).toBe('#1D4ED8')
  })

  it('ignores a corrupted store', () => {
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, 'not-a-color')
    expect(readAccentColor()).toBe(DEFAULT_ACCENT_HEX)
  })
})

describe('applyAccentColor', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.style.removeProperty('--brand-hue')
    document.documentElement.style.removeProperty('--brand-chroma')
  })

  it('writes brand variables onto the document', () => {
    applyAccentColor('#1D4ED8', 'light')

    expect(document.documentElement.dataset['accent']).toBe('#1D4ED8')
    expect(document.documentElement.style.getPropertyValue('--brand-chroma')).not.toBe('')
    expect(
      Number.parseFloat(document.documentElement.style.getPropertyValue('--brand-chroma')),
    ).toBeGreaterThan(0.1)
  })

  it('normalizes a bad value to graphite', () => {
    expect(normalizeAccentHex('nope')).toBe(DEFAULT_ACCENT_HEX)
    expect(applyAccentColor('nope', 'light')).toBe(DEFAULT_ACCENT_HEX)
  })
})
