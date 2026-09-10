import { createContext, use, useSyncExternalStore } from 'react'

import type { IWalletSession, IWalletSnapshot } from './contracts'

/**
 * Wallet session context.
 *
 * No default on purpose: using the session outside the provider is a
 * composition error and must fail immediately, not become a forever-
 * empty screen.
 */
export const WalletContext = createContext<IWalletSession | null>(null)

/**
 * Access to wallet operations.
 *
 * @throws If called outside the provider.
 */
export function useWallet(): IWalletSession {
  const session = use(WalletContext)

  if (session === null) {
    throw new Error('useWallet must be called inside WalletProvider.')
  }

  return session
}

/**
 * Wallet state snapshot with a change subscription.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a stable
 * reference between changes. The session honours that: the snapshot
 * is replaced as a whole and only when data actually changes.
 */
export function useWalletSnapshot(): IWalletSnapshot {
  const session = useWallet()

  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
  )
}
