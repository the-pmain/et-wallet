import { History, LayoutGrid, Settings, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'

import type { TranslationKey } from '@/shared/i18n'

import { ROUTE } from '../router/routes'

export interface INavigationItem {
  readonly to: string

  /**
   * Ключ словаря, а не готовая подпись.
   *
   * Список вычисляется один раз при загрузке модуля, и подпись, взятая
   * из словаря здесь, осталась бы на прежнем языке после переключения.
   */
  readonly labelKey: TranslationKey

  readonly icon: ComponentType<{ className?: string }>
}

/**
 * Разделы разблокированного кошелька.
 *
 * Список вынесен из компонента, потому что используется дважды: нижней
 * панелью на узком экране и боковой на широком. Две копии разошлись бы
 * при первом же добавлении раздела.
 *
 * ЧЕТЫРЕ ПУНКТА — ПРЕДЕЛ. Всплывающее окно расширения имеет ширину около
 * 360 пикселей; пятый пункт делает подписи нечитаемыми, а безымянные
 * значки в кошельке недопустимы: цена ошибочного нажатия слишком велика.
 */
export const NAVIGATION: readonly INavigationItem[] = [
  { to: ROUTE.Dashboard, labelKey: 'nav.wallet', icon: Wallet },
  { to: ROUTE.Assets, labelKey: 'nav.assets', icon: LayoutGrid },
  { to: ROUTE.Activity, labelKey: 'nav.activity', icon: History },
  { to: ROUTE.Settings, labelKey: 'nav.settings', icon: Settings },
]
