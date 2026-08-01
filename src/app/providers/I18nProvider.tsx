import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  DEFAULT_LANGUAGE,
  I18nContext,
  isLanguage,
  translate,
  type I18nContextValue,
  type Language,
} from '@/shared/i18n'

interface I18nProviderProps {
  children: ReactNode

  /** Начальный язык. Без него определяется по настройкам браузера. */
  defaultLanguage?: Language
}

/**
 * Определяет язык по настройкам браузера.
 *
 * Точное совпадение не требуется: `ru-RU`, `ru` и `ru-BY` — один язык.
 * Незнакомый язык даёт значение по умолчанию, а не пустой интерфейс.
 */
function detectLanguage(): Language {
  for (const tag of navigator.languages) {
    const primary = tag.split('-')[0]?.toLowerCase() ?? ''

    if (isLanguage(primary)) {
      return primary
    }
  }

  return DEFAULT_LANGUAGE
}

/**
 * Провайдер локализации.
 *
 * ВЫБОР ПОКА НЕ СОХРАНЯЕТСЯ МЕЖДУ СЕССИЯМИ — по той же причине, что
 * и выбор оформления: постоянного хранилища ещё нет, а прямое обращение
 * к localStorage запрещено правилом ESLint. Промежуточное решение через
 * него создало бы исключение из правила, которое пришлось бы вычищать.
 * Пространство имён и ключ для сохранения уже выделены
 * (`SETTINGS_KEY.Language`).
 *
 * ЯЗЫК ПРОСТАВЛЯЕТСЯ В `lang` КОРНЕВОГО ЭЛЕМЕНТА. Это не косметика:
 * экранный диктор выбирает по нему произношение, а браузер — правила
 * переноса. Страница с русским текстом и `lang="en"` читается вслух
 * неразборчиво.
 */
export function I18nProvider({ children, defaultLanguage }: I18nProviderProps) {
  const [language, setLanguage] = useState<Language>(defaultLanguage ?? detectLanguage)

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const handleSetLanguage = useCallback((next: Language): void => {
    setLanguage(next)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, values) => translate(language, key, values),
      setLanguage: handleSetLanguage,
    }),
    [language, handleSetLanguage],
  )

  return <I18nContext value={value}>{children}</I18nContext>
}
