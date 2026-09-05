import { createContext, use, useSyncExternalStore } from 'react'

import type { IOnboardingService, OnboardingState } from './contracts'

/**
 * Onboarding operations context.
 *
 * No default value, on purpose: calling operations outside the
 * provider is a composition error and must fail immediately, not
 * degrade into dead buttons.
 */
export const OnboardingContext = createContext<IOnboardingService | null>(null)

/** @throws If called outside the provider. */
export function useOnboarding(): IOnboardingService {
  const service = use(OnboardingContext)

  if (service === null) {
    throw new Error('useOnboarding must be called inside OnboardingProvider.')
  }

  return service
}

/**
 * Current wallet state, subscribed to changes.
 *
 * `useSyncExternalStore` instead of a homemade `useEffect` subscription:
 * it works under concurrent rendering and does not show stale state
 * between subscribe and the first event.
 */
export function useOnboardingState(): OnboardingState {
  const service = useOnboarding()

  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getState(),
  )
}
