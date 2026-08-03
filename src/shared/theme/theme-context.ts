import { createContext, use } from 'react'

/** Доступные режимы оформления. `system` следует настройке операционной системы. */
export type Theme = 'light' | 'dark' | 'system'

export interface ThemeContextValue {
  /** Выбранный пользователем режим. */
  readonly theme: Theme
  /** Фактически применённое оформление после разрешения режима `system`. */
  readonly resolvedTheme: 'light' | 'dark'
  /** Меняет режим оформления. */
  setTheme: (theme: Theme) => void
}

/**
 * Контекст темы.
 *
 * ПОЧЕМУ В СЛОЕ `shared`, А НЕ РЯДОМ С ПРОВАЙДЕРОМ. Переключатель
 * оформления живёт на экране настроек, то есть в слое `pages`, которому
 * запрещено обращаться к слою `app`. Провайдер остаётся в `app` — там
 * ему и место, он часть композиции приложения, — а контракт опущен
 * в самый нижний слой, доступный всем.
 *
 * Значение по умолчанию отсутствует намеренно: обращение к теме вне
 * провайдера — ошибка композиции, и она должна проявляться сразу,
 * а не деградировать до светлой темы.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Доступ к текущей теме.
 *
 * @throws Если вызван вне ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)

  if (context === null) {
    throw new Error('useTheme must be called inside ThemeProvider.')
  }

  return context
}
