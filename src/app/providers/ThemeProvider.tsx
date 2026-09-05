import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ThemeContext, type Theme, type ThemeContextValue } from '@/shared/theme'

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

/** Dark-theme CSS class. Matches `@custom-variant dark` in index.css. */
const DARK_CLASS = 'dark'

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light'
}

/**
 * Theme provider.
 *
 * The user's choice is deliberately NOT persisted across sessions:
 * durable storage will arrive with the `core/storage` layer, and
 * talking to localStorage directly is banned by the ESLint rule
 * `no-restricted-globals`. An interim localStorage exception would
 * then have to be cleaned up.
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme)

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
