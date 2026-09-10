import type { Unsubscribe } from '@/core/types'

/** Обработчик события. */
export type EventListener<TPayload> = (payload: TPayload) => void

/**
 * Типизированный источник событий, доступный только на чтение.
 *
 * Разделение на «только чтение» и «чтение + публикация» принципиально.
 * Фасад ядра отдаёт наружу именно этот интерфейс: UI обязан иметь
 * возможность подписаться на смену аккаунта, но не имеет права
 * сфабриковать событие «кошелёк разблокирован».
 *
 * @typeParam TEventMap Карта «имя события -> тип полезной нагрузки».
 */
export interface IEventSource<TEventMap> {
  /**
   * Подписывает обработчик на событие.
   *
   * @returns Функция отписки. Вызывающий обязан вызвать её при размонтировании,
   *          иначе обработчик удержит ссылку на контекст и создаст утечку.
   */
  on<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe

  /** Подписывает обработчик на одно срабатывание. */
  once<TName extends keyof TEventMap>(
    event: TName,
    listener: EventListener<TEventMap[TName]>,
  ): Unsubscribe

  /** Снимает конкретный обработчик. */
  off<TName extends keyof TEventMap>(event: TName, listener: EventListener<TEventMap[TName]>): void
}

/**
 * Шина событий: источник плюс право публикации.
 *
 * Используется только внутри ядра. Наружу не выходит.
 */
export interface IEventBus<TEventMap> extends IEventSource<TEventMap> {
  /** Публикует событие всем подписчикам. */
  emit<TName extends keyof TEventMap>(event: TName, payload: TEventMap[TName]): void

  /** Снимает все обработчики. Вызывается при уничтожении ядра. */
  removeAllListeners(): void
}
