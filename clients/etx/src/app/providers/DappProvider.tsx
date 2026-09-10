import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { DappContext, type DappSessionService, type IDappContextValue } from '@/features/dapp'

interface DappProviderProps {
  readonly children: ReactNode
  readonly service: DappSessionService
}

/**
 * Провайдер подключений к приложениям.
 *
 * СЕРВИС НЕ ПОДНИМАЕТСЯ ЗДЕСЬ. `init` вызывает экран подключений:
 * библиотека WalletConnect весит около трёх мегабайт, и загружать её
 * при старте значило бы замедлить вход в кошелёк всем, включая тех,
 * кто ни к чему не подключается.
 *
 * СОСТОЯНИЕ ЧИТАЕТСЯ ЧЕРЕЗ `useSyncExternalStore` ЦЕЛЫМ СНИМКОМ —
 * как у сессии кошелька. Сервис заменяет снимок целиком, поэтому
 * сравнение по ссылке работает и лишних перерисовок не возникает.
 */
export function DappProvider({ children, service }: DappProviderProps) {
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => service.subscribe(listener), [service]),
    useCallback(() => service.getSnapshot(), [service]),
  )

  /*
    ДЕЙСТВИЯ МЕМОИЗИРУЮТСЯ ОТДЕЛЬНО ОТ СНИМКА, И ЭТО НЕ ОПТИМИЗАЦИЯ.

    Пока они пересоздавались вместе со снимком, экран подключений
    получал новую ссылку на `init` при каждом изменении состояния.
    Его эффект вызывал `init` заново, тот менял снимок — и цикл
    повторялся без конца, подвешивая вкладку целиком.

    Действия зависят только от сервиса и живут столько же, сколько он.
  */
  const actions = useMemo(
    () => ({
      init: () => service.init(),
      pair: (uri: string) => service.pair(uri),
      respondToProposal: (isApproved: boolean) => service.respondToProposal(isApproved),
      respondToRequest: (isApproved: boolean) => service.respondToRequest(isApproved),
      disconnect: (sessionId: string) => service.disconnect(sessionId),
    }),
    [service],
  )

  const value = useMemo<IDappContextValue>(() => ({ snapshot, ...actions }), [snapshot, actions])

  return <DappContext value={value}>{children}</DappContext>
}
