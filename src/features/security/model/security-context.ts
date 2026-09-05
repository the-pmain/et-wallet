import { createContext, use } from 'react'

import { SystemClock, type IClock, type StorageDurability } from '@/core'

import type { IAutoLockState } from './useAutoLock'
import { DEFAULT_SECURITY_SETTINGS, type ISecuritySettings } from './SecuritySettings'

export interface ISecurityContextValue {
  readonly autoLock: IAutoLockState
  readonly settings: ISecuritySettings

  readonly setAutoLockTimeout: (timeoutMs: number) => Promise<void>
  readonly setConfirmBeforeSigning: (enabled: boolean) => Promise<void>

  /** Checks the password without changing the lock state. */
  readonly verifyPassword: (password: string) => Promise<boolean>

  /**
   * The application's clock.
   *
   * WHY SCREENS NEED IT. The countdown to the end of a delay must
   * run on the same clock the limiter uses. A system timer next to
   * an injected clock is two time sources, and they drift: in a
   * test the countdown would not move at all, and in production
   * the shown value would disagree with the real deadline.
   */
  readonly clock: IClock

  /**
   * How reliably storage holds on to data.
   *
   * `null` until the state has been read. That is not "data is
   * unprotected": showing a warning before the answer arrives
   * would scare the owner with something that may not exist.
   */
  readonly storageDurability: StorageDurability | null
}

/**
 * Security-module context.
 *
 * THE DEFAULT VALUE DOES NOT WEAKEN PROTECTION. A component
 * outside the provider gets the default settings (confirm on)
 * and a password check that always refuses. The opposite —
 * "outside the provider everything is allowed" — would turn a
 * forgotten provider into a silent kill-switch for protection.
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

export function useSecurity(): ISecurityContextValue {
  return use(SecurityContext)
}
