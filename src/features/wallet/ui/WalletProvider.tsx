import { useEffect, type ReactNode } from 'react'

import { ONBOARDING_STATE, useOnboardingState } from '@/features/onboarding'

import { WalletContext } from '../model/wallet-context'
import type { IWalletSession } from '../model/contracts'

interface WalletProviderProps {
  readonly children: ReactNode
  readonly session: IWalletSession
}

/**
 * Провайдер сессии кошелька.
 *
 * СЕССИЯ ОТКРЫВАЕТСЯ И ЗАКРЫВАЕТСЯ ПО СОСТОЯНИЮ БЛОКИРОВКИ, а не по
 * монтированию экрана. Привязка к экрану означала бы, что уход со страницы
 * кошелька затирает корневой ключ и возвращает его при возврате — лишняя
 * работа с секретом и лишние обращения к хранилищу. Привязка к блокировке
 * совпадает с настоящим временем жизни секрета.
 *
 * Закрытие выполняется и при размонтировании: вкладка может быть закрыта
 * без блокировки, и оставшиеся таймеры опроса продолжали бы обращаться
 * к узлу.
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
   * Останавливает фоновый опрос, пока вкладка не на виду.
   *
   * ЭТО НЕ ТОЛЬКО ЭКОНОМИЯ. Опрос скрытой вкладки продолжает сообщать
   * оператору узла, что кошелёк с этим адресом открыт, пока пользователь
   * занят другим. Обновлять при этом нечего: экрана никто не видит.
   *
   * Слежение живёт здесь, а не в сессии: `document` — часть DOM,
   * а сессия обязана работать и там, где документа нет.
   */
  useEffect(() => {
    const apply = () => {
      session.setBackgroundRefreshEnabled(document.visibilityState === 'visible')
    }

    apply()
    document.addEventListener('visibilitychange', apply)

    return () => {
      document.removeEventListener('visibilitychange', apply)

      /* Опрос возвращается во включённое состояние: следующий владелец
         этой сессии не обязан знать, что предыдущий экран его выключил. */
      session.setBackgroundRefreshEnabled(true)
    }
  }, [session])

  return <WalletContext value={session}>{children}</WalletContext>
}
