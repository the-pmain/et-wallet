import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import {
  applyAccentColor,
  readAccentColor,
  ThemeContext,
  writeAccentColor,
  type Theme,
  type ThemeContextValue,
} from '@/shared/theme'

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
 * Theme and accent provider.
 *
 * Light / dark / system stay independent of the main colour. The
 * accent is persisted: welcome and unlock already paint with brand
 * tokens, and those screens open before the encrypted store.
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme)
  const [accentHex, setAccentHexState] = useState(readAccentColor)

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

  useLayoutEffect(() => {
    applyAccentColor(accentHex, resolvedTheme)
  }, [accentHex, resolvedTheme])

  const handleSetTheme = useCallback((nextTheme: Theme): void => {
    setTheme(nextTheme)
  }, [])

  const handleSetAccentHex = useCallback((hex: string): void => {
    setAccentHexState(writeAccentColor(hex))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: handleSetTheme,
      accentHex,
      setAccentHex: handleSetAccentHex,
    }),
    [theme, resolvedTheme, handleSetTheme, accentHex, handleSetAccentHex],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
