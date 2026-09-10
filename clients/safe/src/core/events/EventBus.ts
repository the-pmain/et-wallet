import type { Unsubscribe } from '@/core/types'

import type { EventListener, IEventBus } from './types'

/** Handler whose payload type is unknown at the storage layer. */
type AnyListener = (payload: never) => void

interface IListenerEntry {
  readonly listener: AnyListener
  readonly once: boolean
}

export type ListenerErrorHandler = (error: unknown, event: PropertyKey) => void

export interface IEventBusOptions {
  /**
   * Called when a subscriber throws.
   *
   * The bus owner must pass a handler that writes to the log.
   * The default is to rethrow in a separate microtask, i.e. to
   * hit the global unhandled-exception handler. That is noisy,
   * but better than swallowing: a hidden subscriber failure in
   * a wallet means the UI did not learn about a network change
   * or a lock and keeps showing stale state.
   */
  readonly onListenerError?: ListenerErrorHandler
}

/**
 * Typed event bus.
 *
 * The implementation solves three problems that make a naive array
 * of handlers unusable:
 *
 * 1. **Failure isolation.** An exception in one handler must not
 *    stop the others. The error is rethrown in a separate
 *    microtask: it reaches the global unhandled-exception handler
 *    and stays visible, but does not interrupt delivery.
 *
 * 2. **Subscription changes during delivery.** A handler may
 *    unsubscribe in the middle of handling. Iterating a copy of
 *    the set avoids skipping the next handler and infinite loops.
 *
 * 3. **Unsubscribing one-shot handlers.** `once` is stored as a
 *    flag on the entry, not as a wrapper around the function.
 *    Otherwise `off` with the original function would not find a
 *    subscription created through `once`.
 */
export class EventBus<TEventMap> implements IEventBus<TEventMap> {
  readonly #listeners = new Map<keyof TEventMap, Set<IListenerEntry>>()
  readonly #onListenerError: ListenerErrorHandler

  constructor(options: IEventBusOptions = {}) {
    this.#onListenerError =
      options.onListenerError ??
      ((error) => {
        queueMicrotask(() => {
          throw error
        })
      })
  }

  on<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe {
    /* No cast is needed: a function that accepts TEventMap[TName]
       is assignable to a function that accepts never (parameter
       contravariance). */
    return this.#add(event, listener, false)
  }

  once<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe {
    return this.#add(event, listener, true)
  }

  off<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): void {
    const entries = this.#listeners.get(event)

    if (entries === undefined) {
      return
    }

    for (const entry of entries) {
      if (entry.listener === (listener as AnyListener)) {
        entries.delete(entry)
      }
    }

    if (entries.size === 0) {
      this.#listeners.delete(event)
    }
  }

  emit<TName extends keyof TEventMap>(event: TName, payload: TEventMap[TName]): void {
    const entries = this.#listeners.get(event)

    if (entries === undefined) {
      return
    }

    /* Iterate a copy: a handler may change subscriptions during
       delivery, and mutating the set in the loop would skip entries. */
    for (const entry of [...entries]) {
      /* Liveness check is required. A handler unsubscribed by
         another handler in this same delivery must not run: it was
         removed precisely because its reaction became inappropriate.
         This matches EventTarget semantics, not Node's EventEmitter,
         which still calls already-removed handlers. */
      if (!entries.has(entry)) {
        continue
      }

      if (entry.once) {
        entries.delete(entry)
      }

      try {
        const listener = entry.listener as EventListener<TEventMap[TName]>
        listener(payload)
      } catch (error) {
        /* One subscriber's failure does not stop delivery to the rest. */
        this.#onListenerError(error, event)
      }
    }

    if (entries.size === 0) {
      this.#listeners.delete(event)
    }
  }

  removeAllListeners(): void {
    this.#listeners.clear()
  }

  /** Active subscription count for an event. Used in leak tests. */
  listenerCount<TName extends keyof TEventMap>(event: TName): number {
    return this.#listeners.get(event)?.size ?? 0
  }

  #add<TName extends keyof TEventMap>(
    event: TName,
    listener: AnyListener,
    once: boolean,
  ): Unsubscribe {
    let entries = this.#listeners.get(event)

    if (entries === undefined) {
      entries = new Set<IListenerEntry>()
      this.#listeners.set(event, entries)
    }

    const entry: IListenerEntry = { listener, once }
    entries.add(entry)

    return () => {
      const current = this.#listeners.get(event)

      if (current === undefined) {
        return
      }

      current.delete(entry)

      if (current.size === 0) {
        this.#listeners.delete(event)
      }
    }
  }
}
