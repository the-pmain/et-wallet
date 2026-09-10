export interface IOklch {
  readonly l: number
  readonly c: number
  readonly h: number
}

const HEX_SHORT = /^#([0-9a-fA-F]{3})$/u
const HEX_FULL = /^#([0-9a-fA-F]{6})$/u

/**
 * Normalizes a hex color to `#RRGGBB`.
 *
 * Returns `null` for anything that is not a 3- or 6-digit hex value.
 * The picker and storage both go through this so a bad string cannot
 * become a CSS variable.
 */
export function parseHexColor(value: string): string | null {
  const trimmed = value.trim()
  const short = HEX_SHORT.exec(trimmed)

  if (short?.[1] !== undefined) {
    const [red, green, blue] = short[1]
    if (red === undefined || green === undefined || blue === undefined) {
      return null
    }

    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase()
  }

  const full = HEX_FULL.exec(trimmed)
  if (full?.[1] === undefined) {
    return null
  }

  return `#${full[1]}`.toUpperCase()
}

function srgbChannelToLinear(value: number): number {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/**
 * sRGB hex → OKLCH.
 *
 * The design tokens are OKLCH. The picker speaks hex because that is
 * what `<input type="color">` returns. Conversion lives here so every
 * derived token shares one reading of the chosen color.
 */
export function hexToOklch(hex: string): IOklch | null {
  const normalized = parseHexColor(hex)
  if (normalized === null) {
    return null
  }

  const packed = Number.parseInt(normalized.slice(1), 16)
  const red = (packed >> 16) & 255
  const green = (packed >> 8) & 255
  const blue = packed & 255

  const linearRed = srgbChannelToLinear(red)
  const linearGreen = srgbChannelToLinear(green)
  const linearBlue = srgbChannelToLinear(blue)

  const l =
    0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue
  const m =
    0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue
  const s =
    0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue

  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)

  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot

  const chroma = Math.hypot(a, b)
  const hueRadians = chroma < 1e-8 ? 0 : Math.atan2(b, a)
  const hue = (hueRadians * 180) / Math.PI

  return {
    l: lightness,
    c: chroma,
    h: hue < 0 ? hue + 360 : hue,
  }
}
