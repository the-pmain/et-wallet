import { useEffect, type ReactNode } from 'react'

import { ONBOARDING_STATE, useOnboardingState } from '@/features/onboarding'

import { WalletContext } from '../model/wallet-context'
import type { IWalletSession } from '../model/contracts'

interface WalletProviderProps {
  readonly children: ReactNode
  readonly session: IWalletSession
}

/**
 * Wallet session provider.
 *
 * The session opens and closes with lock state, not with screen
 * mount. Binding it to the screen would wipe the root key on leaving
 * the wallet page and restore it on return — extra secret work and
 * extra storage hits. Binding it to lock matches the secret's real
 * lifetime.
 *
 * Close also runs on unmount: the tab can be closed without locking,
 * and leftover poll timers would keep hitting the node.
 */
export function WalletProvider({ children, session }: WalletProviderProps) {
  const onboardingState = useOnboardingState()
  const isUnlocked = onboardingState === ONBOARDING_STATE.Unlocked

  useEffect(() => {
    if (!isUnlocked) {
      void session.close()

      return
    }

    void session.open()

    return () => {
      void session.close()
    }
  }, [isUnlocked, session])

  /**
   * Stops background polling while the tab is hidden.
   *
   * This is not only about saving quota. Polling a hidden tab keeps
   * telling the node operator that a wallet with this address is open
   * while the user is busy elsewhere. There is nothing to refresh: no
   * one sees the screen.
   *
   * The listener lives here, not in the session: `document` is DOM,
   * and the session must run where there is no document.
   */
  useEffect(() => {
    const apply = () => {
      session.setBackgroundRefreshEnabled(document.visibilityState === 'visible')
    }

    apply()
    document.addEventListener('visibilitychange', apply)

    return () => {
      document.removeEventListener('visibilitychange', apply)

      /* Polling is turned back on: the next owner of this session
         should not have to know the previous screen turned it off. */
      session.setBackgroundRefreshEnabled(true)
    }
  }, [session])

  return <WalletContext value={session}>{children}</WalletContext>
}
