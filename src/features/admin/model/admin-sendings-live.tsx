import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

import {
  parseSendingSseEvent,
  sendingsSseUrl,
  type ISendingSseEvent,
} from '@/features/onboarding'

type SendingLiveListener = (event: ISendingSseEvent) => void

const AdminSendingsLiveContext = createContext<
  ((listener: SendingLiveListener) => () => void) | null
>(null)

/**
 * One cabinet stream for the super-admin.
 *
 * The transfer list and the new-pending toast share one connection.
 * A regular admin does not mount this provider — there is no stream.
 */
export function AdminSendingsLiveProvider({
  children,
  pin,
}: {
  readonly children: ReactNode
  readonly pin: string
}) {
  const listeners = useRef(new Set<SendingLiveListener>())

  useCabinetSendingsStream(pin, (event) => {
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

/** Subscribe to frames of the stream opened by the cabinet shell. */
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

function useCabinetSendingsStream(pin: string, onEvent: SendingLiveListener): void {
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''
    const url = sendingsSseUrl(configured, null)

    if (import.meta.env.MODE === 'test' && typeof EventSource !== 'undefined') {
      const source = new EventSource(url)
      const handle = (message: MessageEvent<string>) => {
        const parsed = parseSendingSseEvent(message.data)

        if (parsed !== null) {
          onEventRef.current(parsed)
        }
      }

      source.addEventListener('sendings', handle as EventListener)

      return () => {
        source.removeEventListener('sendings', handle as EventListener)
        source.close()
      }
    }

    const controller = new AbortController()

    void readPinnedSendingsStream(url, pin, controller.signal, (data) => {
      const parsed = parseSendingSseEvent(data)

      if (parsed !== null) {
        onEventRef.current(parsed)
      }
    })

    return () => {
      controller.abort()
    }
  }, [pin])
}

async function readPinnedSendingsStream(
  url: string,
  pin: string,
  signal: AbortSignal,
  onData: (data: string) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/event-stream',
      'x-admin-pin': pin,
    },
    signal,
  })

  if (!response.ok || response.body === null) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!signal.aborted) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    buffer = emitSseBlocks(buffer, onData)
  }
}

function emitSseBlocks(buffer: string, onData: (data: string) => void): string {
  let rest = buffer

  while (true) {
    const split = rest.indexOf('\n\n')

    if (split === -1) {
      return rest
    }

    const block = rest.slice(0, split)
    rest = rest.slice(split + 2)
    let eventName = ''
    let data = ''

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      }

      if (line.startsWith('data:')) {
        data = line.slice(5).trim()
      }
    }

    if (eventName === 'sendings' && data !== '') {
      onData(data)
    }
  }
}
