import { History, LayoutGrid, Settings, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'

import type { TranslationKey } from '@/shared/i18n'

import { ROUTE } from '../router/routes'

export interface INavigationItem {
  readonly to: string

  /**
   * Dictionary key, not a ready-made caption.
   *
   * The list is computed once at module load, and a caption taken from
   * the dictionary here would stay in the previous language after a switch.
   */
  readonly labelKey: TranslationKey

  readonly icon: ComponentType<{ className?: string }>
}

/**
 * Sections of the unlocked wallet.
 *
 * The list is extracted from the component because it is used twice:
 * by the bottom bar on a narrow screen and by the header tabs on a
 * wide one. Two copies would drift on the first added section.
 *
 * FOUR ITEMS IS THE LIMIT. An extension popup is about 360 pixels
 * wide; a fifth item makes captions unreadable, and nameless icons
 * in a wallet are unacceptable: the cost of a wrong tap is too high.
 */
export const NAVIGATION: readonly INavigationItem[] = [
  { to: ROUTE.Dashboard, labelKey: 'nav.wallet', icon: Wallet },
  { to: ROUTE.Assets, labelKey: 'nav.assets', icon: LayoutGrid },
  { to: ROUTE.Activity, labelKey: 'nav.activity', icon: History },
  { to: ROUTE.Settings, labelKey: 'nav.settings', icon: Settings },
]

export interface IInfoLink {
  readonly to: string
  readonly labelKey: TranslationKey
}

/**
 * Legal and informational pages.
 *
 * They are not in the main navigation: four items is the bottom-bar
 * limit, and the cabinet header has no room for them without crowding
 * out the sections. They live in settings.
 */
export const INFO_LINKS: readonly IInfoLink[] = [
  { to: ROUTE.Trust, labelKey: 'info.trust' },
  { to: ROUTE.Privacy, labelKey: 'info.privacy' },
  { to: ROUTE.Terms, labelKey: 'info.terms' },
]
