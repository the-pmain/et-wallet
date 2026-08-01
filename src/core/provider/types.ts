import type { Address, BlockHash, ChainId, HexString, TxHash, Wei } from '@/core/types'

/** Запрос JSON-RPC. */
export interface IRpcRequest {
  readonly method: string

  /**
   * Параметры метода.
   *
   * Тип `unknown[]`, а не строгая схема, сознательно: набор методов
   * JSON-RPC открыт и различается у разных узлов. Типобезопасность
   * обеспечивается типизированными методами интерфейса `IProvider`,
   * а сырой `request` остаётся аварийным выходом для нестандартных вызовов.
   * Валидация ответа — обязанность вызывающего кода.
   */
  readonly params?: readonly unknown[]
}

/** Данные о стоимости газа. */
export interface IFeeData {
  /**
   * Базовая комиссия текущего блока (EIP-1559).
   * `null` в сетях без поддержки EIP-1559.
   */
  readonly baseFeePerGas: bigint | null

  /** Максимальная суммарная цена за единицу газа (EIP-1559). */
  readonly maxFeePerGas: bigint | null

  /** Чаевые валидатору за единицу газа (EIP-1559). */
  readonly maxPriorityFeePerGas: bigint | null

  /** Цена газа для транзакций прежнего формата. */
  readonly gasPrice: bigint | null
}

/** Параметры вызова контракта без изменения состояния (`eth_call`). */
export interface ICallRequest {
  readonly to: Address
  readonly from?: Address
  readonly data?: HexString
  readonly value?: Wei
}

/** Запись журнала событий контракта. */
export interface ILogEntry {
  readonly address: Address
  readonly topics: readonly HexString[]
  readonly data: HexString
  readonly blockNumber: bigint
  readonly transactionHash: TxHash
  readonly logIndex: number
  /** Удалён ли лог из-за реорганизации цепи. */
  readonly removed: boolean
}

/** Квитанция подтверждённой транзакции. */
export interface ITransactionReceipt {
  readonly transactionHash: TxHash
  readonly blockNumber: bigint
  readonly blockHash: BlockHash
  readonly from: Address
  readonly to: Address | null

  /**
   * Успешность выполнения.
   *
   * Транзакция, включённая в блок, могла завершиться откатом. Газ при этом
   * списан. Отображать такую транзакцию как успешную нельзя.
   */
  readonly status: 'success' | 'reverted'

  readonly gasUsed: bigint
  readonly effectiveGasPrice: bigint

  /** Адрес развёрнутого контракта, если транзакция его создавала. */
  readonly contractAddress: Address | null

  readonly logs: readonly ILogEntry[]
}

/** Фильтр выборки логов. */
export interface ILogFilter {
  readonly address?: Address
  readonly topics?: readonly (HexString | null)[]
  readonly fromBlock?: bigint
  readonly toBlock?: bigint
}

/** События транспортного слоя. */
export interface ProviderEventMap {
  /** Появился новый блок. */
  'provider:block': { readonly blockNumber: bigint }
  /** Соединение с узлом восстановлено. */
  'provider:connected': { readonly chainId: ChainId; readonly rpcUrl: string }
  /** Соединение потеряно. */
  'provider:disconnected': { readonly chainId: ChainId; readonly reason: string }
}
