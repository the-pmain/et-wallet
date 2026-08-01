import { createContext, use, useSyncExternalStore } from 'react'

import type { IOnboardingService, OnboardingState } from './contracts'

/**
 * Контекст операций онбординга.
 *
 * Значение по умолчанию отсутствует намеренно: обращение к операциям вне
 * провайдера — ошибка композиции, и она должна проявляться сразу,
 * а не деградировать до неработающих кнопок.
 */
export const OnboardingContext = createContext<IOnboardingService | null>(null)

/**
 * Доступ к операциям онбординга.
 *
 * @throws Если вызван вне провайдера.
 */
export function useOnboarding(): IOnboardingService {
  const service = use(OnboardingContext)

  if (service === null) {
    throw new Error('useOnboarding должен вызываться внутри OnboardingProvider.')
  }

  return service
}

/**
 * Текущее состояние кошелька с подпиской на изменения.
 *
 * `useSyncExternalStore` вместо собственного `useEffect` с подпиской:
 * он корректно работает при параллельном рендеринге и не даёт показать
 * устаревшее состояние между подпиской и первым событием.
 */
export function useOnboardingState(): OnboardingState {
  const service = useOnboarding()

  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getState(),
  )
}
