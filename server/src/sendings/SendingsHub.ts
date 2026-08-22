import type { ISendingSseEvent } from '../api/contracts.ts'

type SendingsListener = {
  readonly userId: string | null
  readonly all: boolean
  readonly send: (event: ISendingSseEvent) => void
}

/**
 * Живые подписчики потока `sendings`.
 *
 * Экран `/wallet/send` слушает свой `user_id`. Кабинет открывает
 * поток без фильтра — `subscribeAll` — и видит каждую новую запись.
 * Подписка с пустым `user_id` и без `all` кадр не получает: иначе
 * гость на `/wallet/send` без сессии видел бы чужие переводы.
 */
export class SendingsHub {
  readonly #listeners = new Set<SendingsListener>()

  subscribe(userId: string | null, send: (event: ISendingSseEvent) => void): () => void {
    return this.#add({ userId, all: false, send })
  }

  subscribeAll(send: (event: ISendingSseEvent) => void): () => void {
    return this.#add({ userId: null, all: true, send })
  }

  publish(event: ISendingSseEvent): void {
    for (const listener of this.#listeners) {
      if (!listener.all && (listener.userId === null || listener.userId !== event.userId)) {
        continue
      }

      listener.send(event)
    }
  }

  #add(listener: SendingsListener): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  get size(): number {
    return this.#listeners.size
  }
}

export function formatSendingsSseFrame(event: ISendingSseEvent): string {
  return `event: sendings\ndata: ${JSON.stringify(event)}\n\n`
}
