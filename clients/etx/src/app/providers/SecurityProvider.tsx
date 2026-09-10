import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { IClock, IStorageService, StorageDurability } from '@/core'
import { ONBOARDING_STATE, useOnboarding, useOnboardingState } from '@/features/onboarding'
import {
  DEFAULT_SECURITY_SETTINGS,
  SecurityContext,
  useAutoLock,
  type ISecurityContextValue,
  type ISecuritySettings,
  type SecuritySettingsRepository,
} from '@/features/security'

interface SecurityProviderProps {
  readonly children: ReactNode
  readonly clock: IClock
  readonly settingsRepository: SecuritySettingsRepository

  /**
   * Хранилище приложения.
   *
   * Нужно ровно ради одного вопроса: переживут ли данные закрытие
   * вкладки и не вправе ли браузер их вытеснить. Ответ определяет,
   * увидит ли владелец предупреждение о риске потерять кошелёк.
   */
  readonly storage: IStorageService
}

/**
 * Модуль безопасности приложения.
 *
 * СОБИРАЕТСЯ ЗДЕСЬ, ПОТОМУ ЧТО ОБЪЕДИНЯЕТ РАЗНЫЕ СЛОИ: отсчёт времени
 * из ядра, события браузера, состояние блокировки из онбординга
 * и настройки из хранилища. Ни один из этих слоёв не вправе знать
 * об остальных.
 *
 * НАСТРОЙКИ ЧИТАЮТСЯ ДО РАЗБЛОКИРОВКИ. Срок автоблокировки хранится
 * незашифрованным именно ради этого: иначе кошелёк не знал бы, через
 * сколько блокироваться, пока пароль не введён.
 */
export function SecurityProvider({
  children,
  clock,
  settingsRepository,
  storage,
}: SecurityProviderProps) {
  const onboarding = useOnboarding()
  const state = useOnboardingState()

  const [settings, setSettings] = useState<ISecuritySettings>(DEFAULT_SECURITY_SETTINGS)
  const [storageDurability, setStorageDurability] = useState<StorageDurability | null>(null)

  /* Состояние хранилища читается один раз: оно не меняется в течение
     сессии, а запрос разрешения на постоянное хранение выполняется
     при открытии базы. */
  useEffect(() => {
    let isActive = true

    void storage.durability().then((durability) => {
      if (isActive) {
        setStorageDurability(durability)
      }
    })

    return () => {
      isActive = false
    }
  }, [storage])

  useEffect(() => {
    let isActive = true

    void settingsRepository.read().then((stored) => {
      if (isActive) {
        setSettings(stored)
      }
    })

    return () => {
      isActive = false
    }
  }, [settingsRepository])

  /* Блокировка вынесена в стабильную ссылку: хук автоблокировки
     пересоздавал бы подписки на каждый рендер, а вместе с ними
     и отсчёт — сессия не истекла бы никогда. */
  const handleExpire = useCallback(() => {
    onboarding.lock()
  }, [onboarding])

  const autoLock = useAutoLock({
    isUnlocked: state === ONBOARDING_STATE.Unlocked,
    timeoutMs: settings.autoLockTimeoutMs,
    clock,
    onExpire: handleExpire,
  })

  const setAutoLockTimeout = useCallback(
    async (timeoutMs: number): Promise<void> => {
      await settingsRepository.setAutoLockTimeout(timeoutMs)
      setSettings((current) => ({ ...current, autoLockTimeoutMs: timeoutMs }))
    },
    [settingsRepository],
  )

  const setConfirmBeforeSigning = useCallback(
    async (enabled: boolean): Promise<void> => {
      await settingsRepository.setConfirmBeforeSigning(enabled)
      setSettings((current) => ({ ...current, confirmBeforeSigning: enabled }))
    },
    [settingsRepository],
  )

  const verifyPassword = useCallback(
    async (password: string): Promise<boolean> => await onboarding.verifyPassword(password),
    [onboarding],
  )

  const value = useMemo<ISecurityContextValue>(
    () => ({
      autoLock,
      settings,
      setAutoLockTimeout,
      setConfirmBeforeSigning,
      verifyPassword,
      clock,
      storageDurability,
    }),
    [
      autoLock,
      settings,
      setAutoLockTimeout,
      setConfirmBeforeSigning,
      verifyPassword,
      clock,
      storageDurability,
    ],
  )

  return <SecurityContext value={value}>{children}</SecurityContext>
}
