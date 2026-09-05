import { useEffect, useMemo, type ReactNode } from 'react'

import {
  DEFAULT_LANGUAGE,
  I18nContext,
  translate,
  type I18nContextValue,
  type Language,
} from '@/shared/i18n'

interface I18nProviderProps {
  children: ReactNode

  /** Interface language. Only one is supported today. */
  defaultLanguage?: Language
}

/**
 * Locale provider.
 *
 * THERE IS ONE LANGUAGE, AND NO PICKER IN THE UI. The wallet speaks
 * English: that is the language of standards, network names, and node
 * messages, and mixing it with a translation would produce phrases
 * like "Insufficient funds for gas" mixed with another language. The substitution machinery is
 * kept — it will be needed when there are more languages.
 *
 * THE LANGUAGE IS SET ON THE ROOT ELEMENT'S `lang`. That is not
 * cosmetics: the screen reader picks pronunciation from it, and the
 * browser picks hyphenation rules.
 */
export function I18nProvider({ children, defaultLanguage }: I18nProviderProps) {
  const language = defaultLanguage ?? DEFAULT_LANGUAGE

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, values) => translate(language, key, values),
    }),
    [language],
  )

  return <I18nContext value={value}>{children}</I18nContext>
}
