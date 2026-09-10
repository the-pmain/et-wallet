import type { AccountEventMap } from '@/core/account'
import type { BalanceEventMap } from '@/core/balance'
import type { NetworkEventMap } from '@/core/network'
import type { TokenEventMap } from '@/core/token'
import type { TransactionEventMap } from '@/core/transaction'
import type { WalletEventMap } from '@/core/wallet'

/**
 * Сводная карта событий ядра.
 *
 * Объединение вместо собственного набора событий у фасада: события уже
 * определены в своих модулях, и дублирование привело бы к рассинхронизации
 * имён. Пересечение имён невозможно — каждое пространство использует
 * собственный префикс (`wallet:`, `account:`, `network:` и так далее).
 *
 * Подписчику достаточно одного источника событий, чтобы получить всё,
 * что происходит в ядре.
 */
export type WalletCoreEventMap = AccountEventMap &
  BalanceEventMap &
  NetworkEventMap &
  TokenEventMap &
  TransactionEventMap &
  WalletEventMap

/** Настройки поведения ядра. */
export interface IWalletCoreConfig {
  /**
   * Время бездействия до автоматической блокировки, в миллисекундах.
   *
   * Значение 0 отключает автоблокировку. Отключение допустимо только как
   * осознанный выбор пользователя: разблокированный кошелёк на оставленном
   * без присмотра устройстве позволяет подписать транзакцию без пароля.
   */
  readonly autoLockTimeoutMs: number

  /** Сеть, активная при первом запуске. */
  readonly defaultChainId: bigint

  /** Периодичность фонового обновления балансов, в миллисекундах. */
  readonly balanceRefreshIntervalMs: number

  /**
   * Минимальная длина пароля.
   *
   * Проверка длины — необходимый, но недостаточный минимум. Полная политика
   * сложности определяется на этапе реализации разблокировки.
   */
  readonly minPasswordLength: number
}
