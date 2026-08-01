import { useEffect, type ReactNode } from 'react'

import { OnboardingContext } from '../model/onboarding-context'
import type { IOnboardingService } from '../model/contracts'

interface OnboardingProviderProps {
  readonly children: ReactNode

  /**
   * Готовый сервис.
   *
   * Обязателен. Раньше провайдер создавал сервис сам, когда его не передали,
   * и это было удобно ровно до появления второго потребителя защищённого
   * хранилища: экран кошелька работает с той же сессией дешифрования,
   * а собранный внутри провайдера сервис невозможно передать ему.
   * Сборка выполняется в composition root.
   */
  readonly service: IOnboardingService
}

/**
 * Провайдер операций онбординга.
 *
 * Сервис живёт всё время работы приложения: он владеет состоянием блокировки
 * и сессионным ключом шифрования, поэтому пересоздание при перерисовке
 * означало бы неожиданную блокировку кошелька.
 */
export function OnboardingProvider({ children, service }: OnboardingProviderProps) {
  useEffect(() => {
    void service.initialize()
  }, [service])

  return <OnboardingContext value={service}>{children}</OnboardingContext>
}
