import type { Unsubscribe } from '@/core/types'

export type EventListener<TPayload> = (payload: TPayload) => void

/**
 * Typed event source, read-only.
 *
 * The split between "read only" and "read + publish" is essential.
 * The core facade exposes this interface: the UI must be able to
 * subscribe to an account change, but must not be able to fabricate
 * a "wallet unlocked" event.
 *
 * @typeParam TEventMap Map of "event name -> payload type".
 */
export interface IEventSource<TEventMap> {
  /**
   * Subscribes a handler to an event.
   *
   * @returns Unsubscribe function. The caller must invoke it on
   *          unmount, otherwise the handler keeps a reference to
   *          its context and leaks.
   */
  on<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe

  once<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe

  off<TName extends keyof TEventMap>(event: TName, listener: EventListener<TEventMap[TName]>): void
}

/**
 * Event bus: the source plus the right to publish.
 *
 * Used only inside the core. It does not go outside.
 */
export interface IEventBus<TEventMap> extends IEventSource<TEventMap> {
  emit<TName extends keyof TEventMap>(event: TName, payload: TEventMap[TName]): void

  /** Removes every handler. Called when the core is destroyed. */
  removeAllListeners(): void
}
