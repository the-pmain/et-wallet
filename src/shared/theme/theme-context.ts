import { createContext, use } from 'react'

/** Available themes. `system` follows the operating-system setting. */
export type Theme = 'light' | 'dark' | 'system'

export interface ThemeContextValue {
  readonly theme: Theme
  /** Theme actually applied after resolving `system`. */
  readonly resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

/**
 * Theme context.
 *
 * WHY IN `shared`, NOT NEXT TO THE PROVIDER. The theme switch lives
 * on the settings screen, in the `pages` layer, which must not import
 * from `app`. The provider stays in `app` — that is composition —
 * and the contract is dropped to the lowest layer, available to all.
 *
 * There is no default on purpose: reading the theme outside the
 * provider is a composition error and must fail immediately, not
 * degrade to the light theme.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Access to the current theme.
 *
 * @throws If called outside ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)

  if (context === null) {
    throw new Error('useTheme must be called inside ThemeProvider.')
  }

  return context
}
