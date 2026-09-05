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
   * App storage.
   *
   * Needed for exactly one question: will the data survive a tab
   * close, and may the browser evict it. The answer decides whether
   * the owner sees a warning about losing the wallet.
   */
  readonly storage: IStorageService
}

/**
 * App security module.
 *
 * ASSEMBLED HERE BECAUSE IT JOINS DIFFERENT LAYERS: time from core,
 * browser events, lock state from onboarding, and settings from
 * storage. None of those layers may know about the others.
 *
 * SETTINGS ARE READ BEFORE UNLOCK. The auto-lock timeout is stored
 * unencrypted for this reason: otherwise the wallet would not know
 * when to lock until the password is entered.
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

  /* Storage state is read once: it does not change during a session,
     and the persistent-storage permission request runs when the
     database opens. */
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

  /* Lock is a stable reference: the auto-lock hook would recreate
     subscriptions on every render, and with them the countdown —
     the session would never expire. */
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
