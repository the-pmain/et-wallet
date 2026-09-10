import themeDefinitions from './themes.json' with { type: 'json' }

export type ThemeId = keyof typeof themeDefinitions

export interface ThemeConfig {
  readonly root: `clients/${string}`
  readonly storageNamespace: string
}

export const THEMES = themeDefinitions as Readonly<Record<ThemeId, ThemeConfig>>
export const THEME_IDS = Object.freeze(Object.keys(THEMES) as ThemeId[])

/**
 * Resolve the client at build-tool startup.
 *
 * There is deliberately no default: silently building the wrong wallet
 * identity is more dangerous than refusing to build.
 */
export function resolveTheme(value: string | undefined): ThemeId {
  if (value !== undefined && Object.hasOwn(THEMES, value)) {
    return value as ThemeId
  }

  throw new Error(
    `THEME must be one of: ${THEME_IDS.join(', ')}. Received: ${JSON.stringify(value ?? '')}.`,
  )
}
