import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ThemeContext, type Theme, type ThemeContextValue } from '@/shared/theme'

/** Медиазапрос, отражающий системную настройку тёмного оформления. */
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

/** CSS-класс тёмной темы. Соответствует `@custom-variant dark` в index.css. */
const DARK_CLASS = 'dark'

interface ThemeProviderProps {
  children: ReactNode
  /** Начальный режим. По умолчанию — системный. */
  defaultTheme?: Theme
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light'
}

/**
 * Провайдер оформления.
 *
 * Выбор пользователя намеренно НЕ сохраняется между сессиями: постоянное
 * хранилище появится вместе со слоем `core/storage`, а прямое обращение
 * к localStorage запрещено правилом ESLint `no-restricted-globals`.
 * Промежуточное решение через localStorage создало бы исключение из правила,
 * которое затем пришлось бы вычищать.
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme)

  /* Отслеживание смены системной темы на лету. */
  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MODE_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const resolvedTheme = theme === 'system' ? systemTheme : theme

  /* Применение класса к корневому элементу — единственный побочный эффект темы. */
  useEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, resolvedTheme === 'dark')
  }, [resolvedTheme])

  const handleSetTheme = useCallback((nextTheme: Theme): void => {
    setTheme(nextTheme)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme: handleSetTheme }),
    [theme, resolvedTheme, handleSetTheme],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
