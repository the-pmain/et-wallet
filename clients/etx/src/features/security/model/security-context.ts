import { createContext, use } from 'react'

import { SystemClock, type IClock, type StorageDurability } from '@/core'

import type { IAutoLockState } from './useAutoLock'
import { DEFAULT_SECURITY_SETTINGS, type ISecuritySettings } from './SecuritySettings'

/** Значение контекста безопасности. */
export interface ISecurityContextValue {
  readonly autoLock: IAutoLockState
  readonly settings: ISecuritySettings

  readonly setAutoLockTimeout: (timeoutMs: number) => Promise<void>
  readonly setConfirmBeforeSigning: (enabled: boolean) => Promise<void>

  /** Проверяет пароль, не меняя состояния блокировки. */
  readonly verifyPassword: (password: string) => Promise<boolean>

  /**
   * Источник времени приложения.
   *
   * ЗАЧЕМ ОН ЭКРАНАМ. Обратный отсчёт до конца задержки обязан идти
   * по тем же часам, по которым ограничитель считает срок. Системный
   * таймер рядом с внедрёнными часами — два источника времени, и они
   * расходятся: в проверке отсчёт не двигался бы вовсе, а в боевом
   * коде показанное значение разошлось бы с действительным сроком.
   */
  readonly clock: IClock

  /**
   * Насколько надёжно хранилище удерживает данные.
   *
   * `null`, пока состояние не прочитано. Отличается от «данные
   * не защищены»: показывать предупреждение до того, как ответ получен,
   * значит пугать владельца тем, чего может не быть.
   */
  readonly storageDurability: StorageDurability | null
}

/**
 * Контекст модуля безопасности.
 *
 * ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ НЕ ОСЛАБЛЯЕТ ЗАЩИТУ. Компонент вне провайдера
 * получает настройки по умолчанию (подтверждение включено) и проверку
 * пароля, которая всегда отвечает отказом. Обратное — «вне провайдера
 * всё разрешено» — превратило бы забытый провайдер в тихое отключение
 * защиты.
 */
export const SecurityContext = createContext<ISecurityContextValue>({
  autoLock: { isWarning: false, remainingMs: null, extend: () => undefined },
  settings: DEFAULT_SECURITY_SETTINGS,
  setAutoLockTimeout: () => Promise.resolve(),
  setConfirmBeforeSigning: () => Promise.resolve(),
  verifyPassword: () => Promise.resolve(false),
  clock: new SystemClock(),
  storageDurability: null,
})

/** Доступ к состоянию безопасности. */
export function useSecurity(): ISecurityContextValue {
  return use(SecurityContext)
}
