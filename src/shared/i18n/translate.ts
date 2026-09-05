import { DICTIONARIES, type Language, type TranslationKey } from './dictionary'

export type TranslationValues = Readonly<Record<string, string | number>>

/**
 * Substitutes values into a translation string.
 *
 * SUBSTITUTION IS TEXTUAL AND EXECUTES NOTHING. A `{name}`
 * placeholder is replaced as-is; the result reaches React as a text
 * node and never becomes markup. A richer templater would open a
 * path to injecting markup from a translation.
 *
 * An unset placeholder stays in place instead of becoming empty:
 * `{amount}` on screen is visible and can be fixed; a blank is not.
 */
function interpolate(template: string, values: TranslationValues | undefined): string {
  if (values === undefined) {
    return template
  }

  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = values[name]

    return value === undefined ? placeholder : String(value)
  })
}

/**
 * Returns a translation for a key.
 *
 * A MISSING TRANSLATION RETURNS THE DEFAULT-LANGUAGE TEXT, NOT THE
 * KEY AND NOT AN EMPTY STRING. A blank where a risk warning belongs
 * is a vanished warning; the string `unlock.failed` on screen scares
 * the user and tells them nothing. Text in another language is at
 * least readable.
 *
 * Types make this case almost impossible: the English dictionary
 * must contain the same keys. The fallback stays for when the
 * dictionary is assembled without types — for example from data.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  return interpolate(DICTIONARIES[language][key], values)
}
