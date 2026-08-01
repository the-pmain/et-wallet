import type { Unsubscribe } from '@/core/types'

import type { EventListener, IEventBus } from './types'

/** Обработчик с неизвестной на уровне хранения полезной нагрузкой. */
type AnyListener = (payload: never) => void

interface IListenerEntry {
  readonly listener: AnyListener
  readonly once: boolean
}

/** Обработчик сбоя подписчика. */
export type ListenerErrorHandler = (error: unknown, event: PropertyKey) => void

export interface IEventBusOptions {
  /**
   * Вызывается, когда подписчик выбросил исключение.
   *
   * Владелец шины обязан передать сюда обработчик, пишущий в журнал.
   * Поведение по умолчанию — переброс исключения в отдельной микрозадаче,
   * то есть попадание в глобальный обработчик необработанных исключений.
   * Это шумно, но лучше молчаливого проглатывания: скрытый сбой подписчика
   * в кошельке означает, что интерфейс не узнал о смене сети или блокировке
   * и продолжает показывать устаревшее состояние.
   */
  readonly onListenerError?: ListenerErrorHandler
}

/**
 * Типизированная шина событий.
 *
 * Реализация решает три проблемы, из-за которых наивный вариант на массиве
 * обработчиков непригоден:
 *
 * 1. **Изоляция сбоев.** Исключение в одном обработчике не должно мешать
 *    остальным. Ошибка перебрасывается в отдельной микрозадаче: так она
 *    попадает в глобальный обработчик необработанных исключений и остаётся
 *    видимой, но не прерывает рассылку.
 *
 * 2. **Изменение подписок во время рассылки.** Обработчик вправе отписаться
 *    прямо в момент обработки. Перебор по копии набора исключает пропуск
 *    следующего обработчика и бесконечный цикл.
 *
 * 3. **Отписка одноразовых обработчиков.** `once` хранится как признак
 *    записи, а не как обёртка над функцией. Иначе `off` с исходной функцией
 *    не нашёл бы подписку, созданную через `once`.
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
    /* Приведение не требуется: функция, принимающая TEventMap[TName],
       присваиваема функции, принимающей never (контравариантность параметра). */
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

    /* Перебор по копии: обработчик вправе менять подписки во время рассылки,
       а изменение набора прямо в цикле привело бы к пропуску записей. */
    for (const entry of [...entries]) {
      /* Проверка на живость обязательна. Обработчик, отписанный другим
         обработчиком в этой же рассылке, вызываться не должен: он снят
         именно потому, что его реакция стала неуместной. Такое поведение
         соответствует семантике EventTarget, а не EventEmitter из Node,
         который вызывает уже снятые обработчики. */
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
        /* Сбой одного подписчика не прерывает рассылку остальным. */
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

  /** Число активных подписок на событие. Используется в тестах на утечки. */
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
