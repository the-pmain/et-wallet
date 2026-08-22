import { useEffect, useRef } from 'react'

import { parseSendingSseEvent, type ISendingSseEvent } from './sending-sse'

/**
 * Поток `GET /v1/sendings`.
 *
 * На `/wallet/send` открывается с `user_id` сессии: кадры чужих
 * переводов туда не приходят. В кабинете на вкладке Sendings
 * передают `null` — сервер шлёт каждую новую запись.
 *
 * Соединение закрывается при уходе со экрана. `onEvent` читается
 * из ссылки: новая функция на каждый рендер не должна рвать поток.
 */
export function useSendingsSse(
  userId: string | null,
  onEvent?: (event: ISendingSseEvent) => void,
): void {
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
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
  }, [userId])
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
