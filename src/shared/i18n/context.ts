import { createContext, use } from 'react'

import { DEFAULT_LANGUAGE, type Language, type TranslationKey } from './dictionary'
import { translate, type TranslationValues } from './translate'

export interface I18nContextValue {
  readonly language: Language

  readonly t: (key: TranslationKey, values?: TranslationValues) => string
}

/**
 * Localization context.
 *
 * THE DEFAULT VALUE WORKS, IT IS NOT `null`. A component outside the
 * provider — for example in an isolated test — must show text, not
 * crash: a blank screen instead of a warning is worse than a warning
 * in the wrong language.
 */
export const I18nContext = createContext<I18nContextValue>({
  language: DEFAULT_LANGUAGE,
  t: (key, values) => translate(DEFAULT_LANGUAGE, key, values),
})

export function useTranslation(): I18nContextValue {
  return use(I18nContext)
}
