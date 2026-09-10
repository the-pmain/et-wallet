import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { DappContext, type DappSessionService, type IDappContextValue } from '@/features/dapp'

interface DappProviderProps {
  readonly children: ReactNode
  readonly service: DappSessionService
}

/**
 * Dapp-connection provider.
 *
 * THE SERVICE IS NOT STARTED HERE. `init` is called by the connections
 * screen: the WalletConnect library is about three megabytes, and
 * loading it at startup would slow wallet entry for everyone,
 * including those who connect to nothing.
 *
 * STATE IS READ THROUGH `useSyncExternalStore` AS A WHOLE SNAPSHOT —
 * same as the wallet session. The service replaces the snapshot as a
 * whole, so reference comparison works and extra redraws do not happen.
 */
export function DappProvider({ children, service }: DappProviderProps) {
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => service.subscribe(listener), [service]),
    useCallback(() => service.getSnapshot(), [service]),
  )

  /*
    ACTIONS ARE MEMOISED SEPARATELY FROM THE SNAPSHOT, AND THIS IS NOT
    AN OPTIMISATION.

    While they were recreated with the snapshot, the connections screen
    received a new `init` reference on every state change. Its effect
    called `init` again, that changed the snapshot — and the loop
    repeated without end, hanging the whole tab.

    Actions depend only on the service and live as long as it does.
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
