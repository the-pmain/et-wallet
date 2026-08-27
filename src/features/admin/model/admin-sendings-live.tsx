import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

import { useSendingsSse, type ISendingSseEvent } from '@/features/onboarding'

type SendingLiveListener = (event: ISendingSseEvent) => void

const AdminSendingsLiveContext = createContext<
  ((listener: SendingLiveListener) => () => void) | null
>(null)

/**
 * Один поток `GET /v1/sendings` на весь кабинет.
 *
 * Список переводов и тост новой pending-записи слушают одно соединение.
 * Два `EventSource` на одни кадры дважды дописали бы строку и дважды
 * показали бы тост.
 */
export function AdminSendingsLiveProvider({ children }: { readonly children: ReactNode }) {
  const listeners = useRef(new Set<SendingLiveListener>())

  useSendingsSse(null, (event) => {
    for (const listener of listeners.current) {
      listener(event)
    }
  })

  const subscribe = useRef((listener: SendingLiveListener) => {
    listeners.current.add(listener)

    return () => {
      listeners.current.delete(listener)
    }
  }).current

  return (
    <AdminSendingsLiveContext.Provider value={subscribe}>
      {children}
    </AdminSendingsLiveContext.Provider>
  )
}

/** Подписка на кадры потока, открытого оболочкой кабинета. */
export function useAdminSendingsLive(onEvent: SendingLiveListener): void {
  const subscribe = useContext(AdminSendingsLiveContext)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (subscribe === null) {
      throw new Error('useAdminSendingsLive must be called inside AdminSendingsLiveProvider.')
    }

    return subscribe((event) => {
      onEventRef.current(event)
    })
  }, [subscribe])
}
