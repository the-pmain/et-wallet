import type { IAccountManager } from '@/core/account'
import type { IBalanceService } from '@/core/balance'
import type { IEventSource } from '@/core/events'
import type { INetworkService } from '@/core/network'
import type { IProvider } from '@/core/provider'
import type { ITokenService } from '@/core/token'
import type { ITransactionService } from '@/core/transaction'
import type { IWallet } from '@/core/wallet'

import type { WalletCoreEventMap } from './types'

/**
 * Фасад ядра: единственная точка входа для слоёв features и pages.
 *
 * Что он делает:
 * - даёт доступ к сервисам через свойства;
 * - управляет жизненным циклом ядра (`init`, `destroy`);
 * - агрегирует события всех подсистем в один источник;
 * - владеет политикой автоблокировки, поскольку она затрагивает всё ядро.
 *
 * Чего он НЕ делает: не содержит правил предметной области. Каждый метод
 * либо делегирует вызов сервису, либо управляет жизненным циклом.
 * Как только сюда попадёт первое «если баланс меньше — то», фасад начнёт
 * превращаться в God Object, а сервисы — в анемичные структуры данных.
 *
 * Почему сервисы доступны как свойства, а не проксируются методами:
 * проксирование пятидесяти методов дало бы пятьдесят строк, не добавляющих
 * ничего, кроме ещё одного места для рассинхронизации сигнатур.
 * Композиция здесь честнее делегирования.
 */
export interface IWalletManager extends IEventSource<WalletCoreEventMap> {
  readonly wallet: IWallet
  readonly accounts: IAccountManager
  readonly networks: INetworkService
  readonly tokens: ITokenService
  readonly balances: IBalanceService
  readonly transactions: ITransactionService

  /**
   * Инициализирует ядро.
   *
   * Порядок обязателен: хранилище с миграциями, затем сети (нужен
   * провайдер), затем кошелёк, затем аккаунты и токены. Нарушение порядка
   * даёт обращение к провайдеру до выбора сети.
   *
   * Идемпотентен: повторный вызов не выполняет инициализацию заново.
   */
  init(): Promise<void>

  /**
   * Провайдер активной сети.
   *
   * `null`, если соединение ещё не установлено либо все узлы недоступны.
   * Метод, а не свойство: провайдер пересоздаётся при смене сети
   * и при отказе узла, поэтому сохранять ссылку на него нельзя.
   */
  getProvider(): IProvider | null

  /**
   * Сбрасывает таймер автоблокировки.
   *
   * Вызывается слоем UI при активности пользователя. Ядро не подписывается
   * на события DOM самостоятельно: в service worker расширения DOM
   * отсутствует, и такая подписка сделала бы ядро непереносимым.
   */
  notifyActivity(): void

  /**
   * Останавливает ядро: блокирует кошелёк, закрывает провайдер,
   * снимает подписки и таймеры.
   *
   * Обязателен к вызову при выгрузке приложения. Незакрытый провайдер
   * продолжает опрашивать узел, а неснятые подписки удерживают ссылки
   * на обработчики.
   */
  destroy(): Promise<void>
}
