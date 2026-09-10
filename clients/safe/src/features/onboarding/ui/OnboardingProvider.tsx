import { useEffect, type ReactNode } from 'react'

import { OnboardingContext } from '../model/onboarding-context'
import type { IOnboardingService } from '../model/contracts'
import type { WalletBroadcast } from '../model/WalletBroadcast'

interface OnboardingProviderProps {
  readonly children: ReactNode

  /**
   * Ready-made service.
   *
   * Required. The provider used to build the service itself when none
   * was passed, which was convenient until a second consumer of the
   * secure store appeared: the wallet screen uses the same decryption
   * session, and a service built inside the provider cannot be handed
   * to it. Assembly happens in the composition root.
   */
  readonly service: IOnboardingService

  /**
   * Inter-tab notification channel.
   *
   * Optional: without it this tab learns of a sibling erase only
   * on reload.
   */
  readonly broadcast?: WalletBroadcast
}

/**
 * Provider of onboarding operations.
 *
 * The service lives for the life of the app: it owns lock state and
 * the session encryption key, so recreating it on rerender would
 * unexpectedly lock the wallet.
 */
export function OnboardingProvider({ children, service, broadcast }: OnboardingProviderProps) {
  useEffect(() => {
    void service.initialize()
  }, [service])

  /**
   * A wallet erase in a sibling tab closes this one.
   *
   * STORAGE IS SHARED, MEMORY IS NOT. The tab holds the encryption key
   * and state snapshot locally, so destroying storage passes it by:
   * it keeps showing balances and can still sign a transfer. Someone
   * who erased the wallet before handing the device over would leave
   * a door open.
   */
  useEffect(() => {
    return broadcast?.subscribe(() => {
      service.handleExternalReset()
    })
  }, [broadcast, service])

  return <OnboardingContext value={service}>{children}</OnboardingContext>
}
