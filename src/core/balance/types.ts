import type { ITokenRef } from '@/core/token'
import type { Address, ChainId, Timestamp } from '@/core/types'

/**
 * Баланс одного токена на одном адресе.
 *
 * СОЗНАТЕЛЬНО НЕ СОДЕРЖИТ отформатированной строки вида `1.234 ETH`.
 *
 * Форматирование зависит от локали, числа отображаемых знаков и настроек
 * пользователя — то есть относится к слою представления. Поле `formatted`
 * в доменной модели означало бы, что ядро принимает решения об отображении
 * и что при смене языка потребуется пересчитать все балансы.
 *
 * Ядро отдаёт `raw` и `decimals`. Преобразование выполняет UI.
 */
export interface IBalance {
  readonly owner: Address
  readonly chainId: ChainId
  readonly token: ITokenRef

  /**
   * Значение в минимальных единицах токена.
   *
   * Только `bigint`. Перевод в `number` при `decimals = 18` теряет точность
   * уже на суммах порядка десятых долей токена.
   */
  readonly raw: bigint

  /** Число десятичных знаков токена. Дублируется здесь, чтобы UI мог
      отформатировать значение, не разрешая ссылку на токен. */
  readonly decimals: number

  /** Момент получения значения. Нужен для показа устаревших данных. */
  readonly updatedAt: Timestamp

  /**
   * Значение получено из кэша, а не из сети.
   *
   * Интерфейс обязан отличать актуальный баланс от сохранённого:
   * решение об отправке средств на основании устаревшего значения
   * приводит к отклонению транзакции сетью.
   */
  readonly isStale: boolean
}

/** Совокупность балансов адреса в одной сети. */
export interface IAccountBalances {
  readonly owner: Address
  readonly chainId: ChainId
  readonly native: IBalance
  readonly tokens: readonly IBalance[]
  readonly updatedAt: Timestamp
}

/** События слоя балансов. */
export interface BalanceEventMap {
  'balance:updated': {
    readonly owner: Address
    readonly chainId: ChainId
    readonly token: ITokenRef
  }
  'balance:refreshFailed': {
    readonly owner: Address
    readonly chainId: ChainId
    readonly reason: string
  }
}
