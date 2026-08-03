import { useEffect, type ReactNode } from 'react'

import { OnboardingContext } from '../model/onboarding-context'
import type { IOnboardingService } from '../model/contracts'
import type { WalletBroadcast } from '../model/WalletBroadcast'

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

  /**
   * Канал оповещения между вкладками.
   *
   * Необязателен: без него вкладка узнаёт о стирании кошелька
   * в соседней только при перезагрузке.
   */
  readonly broadcast?: WalletBroadcast
}

/**
 * Провайдер операций онбординга.
 *
 * Сервис живёт всё время работы приложения: он владеет состоянием блокировки
 * и сессионным ключом шифрования, поэтому пересоздание при перерисовке
 * означало бы неожиданную блокировку кошелька.
 */
export function OnboardingProvider({ children, service, broadcast }: OnboardingProviderProps) {
  useEffect(() => {
    void service.initialize()
  }, [service])

  /**
   * Стирание кошелька в соседней вкладке закрывает эту.
   *
   * ХРАНИЛИЩЕ ОБЩЕЕ, А ПАМЯТЬ — НЕТ. Вкладка держит ключ шифрования
   * и снимок состояния у себя, поэтому уничтожение хранилища проходит
   * мимо неё: она продолжает показывать балансы и позволяет подписать
   * перевод. Человек, стерший кошелёк перед передачей устройства,
   * оставлял бы открытую дверь.
   */
  useEffect(() => {
    return broadcast?.subscribe(() => {
      service.handleExternalReset()
    })
  }, [broadcast, service])

  return <OnboardingContext value={service}>{children}</OnboardingContext>
}
