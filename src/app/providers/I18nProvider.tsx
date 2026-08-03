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

  /** Язык интерфейса. Сейчас поддержан один. */
  defaultLanguage?: Language
}

/**
 * Провайдер локализации.
 *
 * ЯЗЫК ОДИН, И ВЫБОРА В ИНТЕРФЕЙСЕ НЕТ. Кошелёк говорит по-английски:
 * это язык стандартов, названий сетей и сообщений узлов, а смешение
 * с переводом порождало бы фразы вроде «Недостаточно средств для gas».
 * Механизм подстановки сохранён — он понадобится, когда языков станет
 * больше.
 *
 * ЯЗЫК ПРОСТАВЛЯЕТСЯ В `lang` КОРНЕВОГО ЭЛЕМЕНТА. Это не косметика:
 * экранный диктор выбирает по нему произношение, а браузер — правила
 * переноса.
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
