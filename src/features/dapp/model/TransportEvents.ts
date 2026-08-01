import { EventBus, type SessionTransportEventMap } from '@/core'

/**
 * Шина событий транспорта.
 *
 * Отдельный класс, а не прямое использование `EventBus`: транспорт
 * будет не один, и одинаковая типизация подписки нужна каждому.
 * Наследование здесь было бы лишним — достаточно узкой обёртки.
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
