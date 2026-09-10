import { hexToOklch, parseHexColor } from './oklch'

export interface IAccentPreset {
  readonly id: string
  readonly label: string
  readonly hex: string
}

export interface IAccentTokens {
  readonly hue: number
  readonly chroma: number
  readonly primaryL: number
  readonly emphasisL: number
  readonly fgL: number
}

/**
 * Graphite is the product default.
 *
 * A near-black gray, not the old purple. Saturated presets exist so
 * someone can pick a hue; the first load must not assume one.
 */
export const ACCENT_PRESETS: readonly IAccentPreset[] = [
  { id: 'graphite', label: 'Graphite', hex: '#3A3A40' },
  { id: 'slate', label: 'Slate', hex: '#334155' },
  { id: 'navy', label: 'Navy', hex: '#1E3A5F' },
  { id: 'forest', label: 'Forest', hex: '#1F3D2B' },
  { id: 'burgundy', label: 'Burgundy', hex: '#5C2A32' },
  { id: 'azure', label: 'Azure', hex: '#1D4ED8' },
  { id: 'teal', label: 'Teal', hex: '#0F766E' },
  { id: 'violet', label: 'Violet', hex: '#6D28D9' },
]

export const DEFAULT_ACCENT_HEX = ACCENT_PRESETS[0]?.hex ?? '#3A3A40'

const NEUTRAL_HUE = 275
const MAX_CHROMA = 0.26
const NEUTRAL_CHROMA_CEILING = 0.04

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Turns a chosen hex into the OKLCH knobs the stylesheet reads.
 *
 * Light and dark keep their own lightness recipe. The hex supplies
 * hue and chroma; the theme supplies how light the fill is, so a
 * black accent stays a dark button on white and a lifted dark button
 * on the night canvas — not a stain that disappears into the page.
 */
export function resolveAccentTokens(
  hex: string,
  theme: 'light' | 'dark',
): IAccentTokens {
  const parsed = hexToOklch(hex)
  const lightness = parsed?.l ?? 0.32
  const chroma = clamp(parsed?.c ?? 0.01, 0, MAX_CHROMA)
  const hue = parsed !== null && chroma > 0.002 ? parsed.h : NEUTRAL_HUE
  const isNeutral = chroma < NEUTRAL_CHROMA_CEILING

  if (theme === 'light') {
    const primaryL = isNeutral ? clamp(lightness, 0.18, 0.38) : clamp(lightness, 0.38, 0.52)

    return {
      hue,
      chroma: isNeutral ? Math.max(chroma, 0.01) : chroma,
      primaryL,
      emphasisL: primaryL,
      fgL: primaryL < 0.55 ? 0.99 : 0.16,
    }
  }

  if (isNeutral) {
    return {
      hue,
      chroma: 0.01,
      primaryL: clamp(Math.max(lightness, 0.34), 0.32, 0.42),
      emphasisL: 0.82,
      fgL: 0.99,
    }
  }

  const primaryL = clamp(lightness + 0.1, 0.52, 0.68)

  return {
    hue,
    chroma,
    primaryL,
    emphasisL: Math.min(primaryL + 0.17, 0.8),
    fgL: 0.99,
  }
}

export function normalizeAccentHex(value: string): string {
  return parseHexColor(value) ?? DEFAULT_ACCENT_HEX
}

/**
 * Writes brand tokens onto the document root.
 *
 * Every tinted surface — buttons, nav, aurora, coins — reads these
 * variables. Setting them here is what makes a settings change land
 * everywhere without a leftover hardcoded purple.
 */
export function applyAccentColor(hex: string, theme: 'light' | 'dark'): string {
  const normalized = normalizeAccentHex(hex)
  const tokens = resolveAccentTokens(normalized, theme)
  const root = document.documentElement

  root.style.setProperty('--brand-hue', tokens.hue.toFixed(2))
  root.style.setProperty('--brand-chroma', tokens.chroma.toFixed(4))
  root.style.setProperty('--brand-primary-l', tokens.primaryL.toFixed(4))
  root.style.setProperty('--brand-emphasis-l', tokens.emphasisL.toFixed(4))
  root.style.setProperty('--brand-fg-l', tokens.fgL.toFixed(4))
  root.dataset['accent'] = normalized

  return normalized
}
