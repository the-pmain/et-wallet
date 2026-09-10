import { useEffect, useRef } from 'react'

import { parseSendingSseEvent, type ISendingSseEvent } from './sending-sse'

/**
 * `GET /v1/sendings` stream.
 *
 * On `/wallet/send` it opens with the session `user_id`: frames for
 * other people's transfers do not arrive. The cabinet Sendings tab
 * passes `null` — the server sends every new record.
 *
 * The connection closes on leave. `onEvent` is read from a ref: a new
 * function every render must not tear the stream down.
 */
export function useSendingsSse(
  userId: string | null,
  onEvent?: (event: ISendingSseEvent) => void,
  enabled = true,
): void {
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      return
    }

    const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''
    const source = new EventSource(sendingsSseUrl(configured, userId))

    const handle = (message: MessageEvent<string>) => {
      const listener = onEventRef.current

      if (listener === undefined) {
        return
      }

      const parsed = parseSendingSseEvent(message.data)

      if (parsed !== null) {
        listener(parsed)
      }
    }

    source.addEventListener('sendings', handle as EventListener)

    return () => {
      source.removeEventListener('sendings', handle as EventListener)
      source.close()
    }
  }, [enabled, userId])
}

export function sendingsSseUrl(baseUrl: string, userId: string | null): string {
  const path =
    userId === null || userId === ''
      ? '/v1/sendings'
      : `/v1/sendings?user_id=${encodeURIComponent(userId)}`

  if (baseUrl === '') {
    return path
  }

  return `${baseUrl.replace(/\/$/u, '')}${path}`
}
