import type { IEventSource } from '@/core/events'
import type { ITokenRef } from '@/core/token'
import type { Address, ChainId, Unsubscribe } from '@/core/types'

import type { BalanceEventMap, IAccountBalances, IBalance } from './types'

/**
 * Получение и кэширование балансов.
 *
 * Кэш обязателен: запрос балансов десяти токенов на каждый переход по
 * интерфейсу исчерпает лимиты публичного RPC-узла за минуты. Но кэш обязан
 * быть явным — см. флаг `isStale` в `IBalance`.
 *
 * Сервис ничего не форматирует. Обоснование — в комментарии к `IBalance`.
 */
export interface IBalanceService extends IEventSource<BalanceEventMap> {
  /**
   * Баланс нативной валюты.
   *
   * Возвращает кэшированное значение немедленно, если оно есть, и
   * инициирует фоновое обновление. Обновлённое значение приходит
   * событием `balance:updated`.
   */
  getNative(owner: Address, chainId: ChainId): Promise<IBalance>

  /** Баланс конкретного токена. */
  getToken(owner: Address, token: ITokenRef): Promise<IBalance>

  /**
   * Все балансы адреса в сети.
   *
   * Реализация обязана объединять запросы в пакет (multicall либо batch
   * JSON-RPC). Последовательные одиночные запросы на каждый токен — это
   * десятки обращений к узлу на один экран.
   */
  getAll(owner: Address, chainId: ChainId): Promise<IAccountBalances>

  /**
   * Принудительно перезапрашивает балансы, игнорируя кэш.
   *
   * Вызывается после подтверждения транзакции и по явному действию
   * пользователя.
   */
  refresh(owner: Address, chainId: ChainId): Promise<IAccountBalances>

  /**
   * Подписывает на автоматическое обновление балансов адреса.
   *
   * @returns Функция отписки. Обязательна к вызову при размонтировании:
   *          неотменённая подписка продолжает опрашивать узел.
   */
  subscribe(owner: Address, chainId: ChainId): Unsubscribe

  /** Сбрасывает кэш. Вызывается при смене сети и при блокировке. */
  invalidate(owner?: Address, chainId?: ChainId): void
}
