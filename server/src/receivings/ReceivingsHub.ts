import type { IReceivingSseEvent } from '../api/contracts.ts'

type ReceivingsListener = {
  readonly userId: string | null
  readonly all: boolean
  readonly send: (event: IReceivingSseEvent) => void
}

/**
 * Live subscribers of the `receivings` stream.
 *
 * Activity listens with `user_id`. The cabinet opens the stream with
 * no filter — `subscribeAll` — and sees every new record.
 */
export class ReceivingsHub {
  readonly #listeners = new Set<ReceivingsListener>()

  subscribe(userId: string | null, send: (event: IReceivingSseEvent) => void): () => void {
    return this.#add({ userId, all: false, send })
  }

  subscribeAll(send: (event: IReceivingSseEvent) => void): () => void {
    return this.#add({ userId: null, all: true, send })
  }

  publish(event: IReceivingSseEvent): void {
    for (const listener of this.#listeners) {
      if (!listener.all && (listener.userId === null || listener.userId !== event.userId)) {
        continue
      }

      listener.send(event)
    }
  }

  #add(listener: ReceivingsListener): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  get size(): number {
    return this.#listeners.size
  }
}

export function formatReceivingsSseFrame(event: IReceivingSseEvent): string {
  return `event: receivings\ndata: ${JSON.stringify(event)}\n\n`
}
