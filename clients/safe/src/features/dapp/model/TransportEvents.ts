import { EventBus, type SessionTransportEventMap } from '@/core'

/**
 * Transport event bus.
 *
 * A separate class, not a raw `EventBus`: there will be more than
 * one transport, and each needs the same subscription typing.
 * Inheritance would be surplus — a narrow wrapper is enough.
 */
export class TransportEvents {
  readonly #bus = new EventBus<SessionTransportEventMap>()

  emit<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    payload: SessionTransportEventMap[TEvent],
  ): void {
    this.#bus.emit(event, payload)
  }

  on<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    listener: (payload: SessionTransportEventMap[TEvent]) => void,
  ): () => void {
    return this.#bus.on(event, listener)
  }
}
