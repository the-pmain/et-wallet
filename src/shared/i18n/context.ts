import { createContext, use } from 'react'

import { DEFAULT_LANGUAGE, type Language, type TranslationKey } from './dictionary'
import { translate, type TranslationValues } from './translate'

/** Значение контекста локализации. */
export interface I18nContextValue {
  readonly language: Language

  /** Переводит по ключу, подставляя значения. */
  readonly t: (key: TranslationKey, values?: TranslationValues) => string

  readonly setLanguage: (language: Language) => void
}

/**
 * Контекст локализации.
 *
 * ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ РАБОЧЕЕ, А НЕ `null`. Компонент, оказавшийся
 * вне провайдера — например, в изолированном тесте, — обязан показать
 * текст, а не упасть: пустой экран вместо предупреждения хуже, чем
 * предупреждение не на том языке.
 */
export const I18nContext = createContext<I18nContextValue>({
  language: DEFAULT_LANGUAGE,
  t: (key, values) => translate(DEFAULT_LANGUAGE, key, values),
  setLanguage: () => undefined,
})

/** Доступ к переводам. */
export function useTranslation(): I18nContextValue {
  return use(I18nContext)
}
