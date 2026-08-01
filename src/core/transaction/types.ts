import type { Address, ChainId, HexString, Timestamp, TxHash, Wei } from '@/core/types'

/**
 * Формат транзакции.
 *
 * `Eip1559` — основной для современных сетей: комиссия делится на базовую
 * (сжигается) и приоритетную (валидатору). `Legacy` сохраняется для сетей
 * без поддержки EIP-1559.
 */
export const TRANSACTION_TYPE = {
  Legacy: 'legacy',
  Eip2930: 'eip2930',
  Eip1559: 'eip1559',
} as const

export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE]

/** Состояние транзакции в жизненном цикле. */
export const TRANSACTION_STATUS = {
  /** Подписана и отправлена, в блок не включена. */
  Pending: 'pending',
  /** Включена в блок и выполнена успешно. */
  Confirmed: 'confirmed',
  /**
   * Включена в блок, но выполнение откачено.
   * Газ списан. Отображать как успешную нельзя.
   */
  Reverted: 'reverted',
  /** Вытеснена из мемпула без включения в блок. */
  Dropped: 'dropped',
  /** Замещена другой транзакцией с тем же nonce (ускорение или отмена). */
  Replaced: 'replaced',
} as const

export type TransactionStatus = (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS]

/** Уровень срочности, влияющий на предлагаемую комиссию. */
export const FEE_PRIORITY = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Custom: 'custom',
} as const

export type FeePriority = (typeof FEE_PRIORITY)[keyof typeof FEE_PRIORITY]

/**
 * Намерение пользователя отправить транзакцию.
 *
 * Неполный набор: параметры комиссии и nonce вычисляются сервисом.
 * Разделение на «намерение» и «готовая к подписи транзакция» существует
 * для того, чтобы вычисленные значения нельзя было подменить в обход
 * проверок — на подпись уходит только результат `prepare`.
 */
export interface ITransactionRequest {
  /**
   * Сеть, в которой отправляется перевод.
   *
   * Не выводится из активной сети по умолчанию сознательно: намерение,
   * не содержащее сети, становится двусмысленным, если пользователь
   * переключит сеть между заполнением формы и подтверждением. Опущенное
   * значение означает активную сеть на момент подготовки.
   */
  readonly chainId?: ChainId

  readonly from: Address

  /** Получатель. `null` означает развёртывание контракта. */
  readonly to: Address | null

  readonly value: Wei

  /** Данные вызова. Пустая строка для простого перевода. */
  readonly data?: HexString

  /** Явно заданный nonce. Обычно не указывается — вычисляется сервисом. */
  readonly nonce?: number

  /** Явно заданный лимит газа. Обычно не указывается — оценивается сервисом. */
  readonly gasLimit?: bigint

  readonly feePriority?: FeePriority
}

/**
 * Транзакция, полностью готовая к подписи.
 *
 * Все поля разрешены и проверены. Это ровно тот набор данных, который
 * подписывается и который обязан быть показан пользователю без каких-либо
 * промежуточных пересчётов «для удобства». Расхождение между показанным
 * и подписанным — основной класс атак на интерфейс кошелька.
 */
export interface ISignableTransaction {
  readonly type: TransactionType
  readonly chainId: ChainId
  readonly from: Address
  readonly to: Address | null
  readonly value: Wei
  readonly data: HexString
  readonly nonce: number
  readonly gasLimit: bigint

  /** Заполняется для EIP-1559. */
  readonly maxFeePerGas: bigint | null
  readonly maxPriorityFeePerGas: bigint | null

  /** Заполняется для транзакций прежнего формата. */
  readonly gasPrice: bigint | null
}

/** Результат подписи. */
export interface ISignedTransaction {
  /** Сериализованная подписанная транзакция для публикации в сети. */
  readonly raw: HexString

  /** Хэш, вычисленный из подписанных данных. */
  readonly hash: TxHash

  /** Исходные данные — для отображения и сохранения в истории. */
  readonly transaction: ISignableTransaction
}

/** Оценка комиссии для одного уровня срочности. */
export interface IFeeEstimate {
  readonly priority: FeePriority
  readonly maxFeePerGas: bigint | null
  readonly maxPriorityFeePerGas: bigint | null
  readonly gasPrice: bigint | null
  readonly gasLimit: bigint

  /** Верхняя граница списания: `gasLimit * maxFeePerGas`. */
  readonly maxCost: Wei

  /** Ожидаемое время подтверждения в секундах. `null`, если оценка недоступна. */
  readonly estimatedSeconds: number | null
}

/** Запись истории транзакций. */
export interface ITransactionRecord {
  readonly hash: TxHash
  readonly chainId: ChainId
  readonly from: Address
  readonly to: Address | null
  readonly value: Wei
  readonly nonce: number
  readonly status: TransactionStatus
  readonly type: TransactionType

  /** Момент отправки из кошелька. */
  readonly submittedAt: Timestamp

  /** Момент включения в блок. `null` пока транзакция не подтверждена. */
  readonly confirmedAt: Timestamp | null

  readonly blockNumber: bigint | null
  readonly gasUsed: bigint | null
  readonly effectiveGasPrice: bigint | null

  /** Хэш замещающей транзакции, если эта была вытеснена. */
  readonly replacedBy: TxHash | null

  /**
   * Сколько блоков подтвердило транзакцию.
   *
   * Ноль, пока она не включена в блок. Единица означает «включена
   * в последний блок» — состояние, из которого реорганизация цепи
   * ещё может её вернуть.
   *
   * ПОЧЕМУ ЭТО ОТДЕЛЬНОЕ ЧИСЛО, А НЕ ПРИЗНАК «ПОДТВЕРЖДЕНА».
   * Включение в блок и невозвратность — разные вещи, и разница видна
   * пользователю: «в блоке» показывается сразу, а глубина подтверждения
   * растёт. Признак вместо числа заставил бы выбрать один порог
   * и выдавать его за истину.
   */
  readonly confirmations: number
}

/**
 * Данные для подписи по EIP-712.
 *
 * Подпись структурированных данных опаснее подписи транзакции: пользователь
 * подписывает не перевод, а произвольное сообщение, которое затем может быть
 * предъявлено контракту. Классический пример — разрешение `Permit`,
 * дающее право распоряжаться токенами без отдельной транзакции.
 *
 * Реализация обязана показывать разобранную структуру, а не сырой хэш,
 * и проверять, что `domain.chainId` совпадает с активной сетью.
 */
export interface ITypedData {
  readonly domain: ITypedDataDomain
  readonly types: Readonly<Record<string, readonly ITypedDataField[]>>
  readonly primaryType: string
  readonly message: Readonly<Record<string, unknown>>
}

export interface ITypedDataDomain {
  readonly name?: string
  readonly version?: string
  readonly chainId?: ChainId
  readonly verifyingContract?: Address
  readonly salt?: HexString
}

export interface ITypedDataField {
  readonly name: string
  readonly type: string
}

/** События транзакционного слоя. */
export interface TransactionEventMap {
  'transaction:submitted': { readonly record: ITransactionRecord }
  'transaction:statusChanged': {
    readonly hash: TxHash
    readonly status: TransactionStatus
  }
}
