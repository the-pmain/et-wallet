import type { ISendingSseEvent } from '../api/contracts.ts'

type SendingsListener = {
  readonly userId: string | null
  readonly all: boolean
  readonly send: (event: ISendingSseEvent) => void
}

/**
 * Live subscribers of the `sendings` stream.
 *
 * `/wallet/send` listens to its `user_id`. The cabinet opens the
 * stream with no filter — `subscribeAll` — and sees every new record.
 * A subscription with an empty `user_id` and without `all` gets no
 * frame: otherwise a guest on `/wallet/send` without a session would
 * see other people's transfers.
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
