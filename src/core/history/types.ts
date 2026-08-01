import type { Address, ChainId, Timestamp, TxHash } from '@/core/types'

/** Что именно переведено. */
export const TRANSFER_KIND = {
  /** Нативная валюта сети. */
  Native: 'native',
  /** Взаимозаменяемый токен ERC-20. */
  Erc20: 'erc20',
  /** Невзаимозаменяемый токен ERC-721. */
  Erc721: 'erc721',
  /** Токен ERC-1155: и взаимозаменяемый, и уникальный в одном контракте. */
  Erc1155: 'erc1155',
} as const

export type TransferKind = (typeof TRANSFER_KIND)[keyof typeof TRANSFER_KIND]

/** Направление относительно аккаунта, чья история запрошена. */
export const TRANSFER_DIRECTION = {
  Incoming: 'incoming',
  Outgoing: 'outgoing',
  /** Отправитель и получатель — один и тот же аккаунт. */
  Self: 'self',
} as const

export type TransferDirection = (typeof TRANSFER_DIRECTION)[keyof typeof TRANSFER_DIRECTION]

/**
 * Сведения о токене, сопровождающие перевод.
 *
 * ВСЕ ПОЛЯ МОГУТ ОТСУТСТВОВАТЬ, И ЭТО НЕ ИСКЛЮЧИТЕЛЬНАЯ СИТУАЦИЯ.
 * Контракт не обязан реализовывать `symbol()` и `decimals()`: они входят
 * в необязательную часть ERC-20. Источник истории также может их не
 * сообщить.
 *
 * `decimals: null` ОБЯЗАН ОБРАБАТЫВАТЬСЯ ОТДЕЛЬНО. Подстановка привычных
 * восемнадцати знаков вместо неизвестного значения искажает сумму
 * на порядки: перевод 1000 USDC (шесть знаков) превратился бы
 * в 0.000000000001. Интерфейсу следует показывать необработанные единицы
 * с явной пометкой.
 */
export interface ITransferAsset {
  /** Адрес контракта. `null` для нативной валюты. */
  readonly contract: Address | null

  /**
   * Символ.
   *
   * НЕДОВЕРЕННОЕ ЗНАЧЕНИЕ: его задаёт автор контракта, и ничто не мешает
   * выпустить токен с символом существующего. Интерфейс обязан отличать
   * проверенные токены от произвольных.
   */
  readonly symbol: string | null

  /** Число десятичных знаков. `null`, если контракт его не сообщил. */
  readonly decimals: number | null
}

/**
 * Одна запись истории.
 *
 * ЭТО НЕ ТРАНЗАКЦИЯ, А ПЕРЕВОД. Одна транзакция порождает несколько
 * переводов: обмен токенов — минимум два, раздача — сотни. Ключом служит
 * пара «хэш транзакции + порядковый номер внутри неё», а не один хэш.
 */
export interface ITransferRecord {
  /** Устойчивый идентификатор записи: хэш плюс номер внутри транзакции. */
  readonly id: string

  readonly hash: TxHash
  readonly chainId: ChainId
  readonly kind: TransferKind
  readonly direction: TransferDirection

  readonly from: Address
  /** `null` при выпуске токена либо развёртывании контракта. */
  readonly to: Address | null

  /**
   * Сумма в минимальных единицах.
   *
   * Для ERC-721 всегда единица: уникальный предмет не делится.
   */
  readonly value: bigint

  /** Идентификатор предмета. Заполняется для ERC-721 и ERC-1155. */
  readonly tokenId: bigint | null

  readonly asset: ITransferAsset

  readonly blockNumber: bigint

  /**
   * Время включения в блок.
   *
   * `null`, если источник его не сообщил: узел не отдаёт время вместе
   * с логом, а запрашивать заголовок блока на каждую запись — десятки
   * лишних обращений на один экран.
   */
  readonly timestamp: Timestamp | null

  /** Происхождение записи. Показывается пользователю. */
  readonly source: TransferSource
}

/** Откуда получена запись. */
export const TRANSFER_SOURCE = {
  /** Собственная отправка, сохранённая кошельком локально. */
  Local: 'local',
  /** Индексатор: полная история, включая нативные переводы. */
  Indexer: 'indexer',
  /** Разбор журналов узла: только токены, ограниченное окно. */
  Logs: 'logs',
} as const

export type TransferSource = (typeof TRANSFER_SOURCE)[keyof typeof TRANSFER_SOURCE]

/** Что именно ограничивает полученную историю. */
export interface IHistoryLimits {
  /**
   * Нативные переводы недоступны источнику.
   *
   * Верно для разбора журналов: перевод нативной валюты не порождает
   * события и в журналах отсутствует физически.
   */
  readonly nativeTransfersUnavailable: boolean

  /**
   * История ограничена окном в блоках.
   *
   * `null` означает полную историю. Число блоков сообщается, чтобы
   * интерфейс мог честно сказать, за какой период показаны данные.
   */
  readonly scannedBlocks: number | null

  /**
   * Ни один источник не ответил.
   *
   * ОТЛИЧАТЬ ЭТО ОТ ПУСТОЙ ИСТОРИИ ОБЯЗАТЕЛЬНО. «Операций не было»
   * и «узнать не удалось» — разные утверждения, и второе, выданное
   * за первое, читается владельцем как пропажа средств.
   *
   * Случай не гипотетический: публичные узлы отказывают в выборке
   * журналов без указания контракта, а именно такая выборка нужна,
   * чтобы найти переводы всех токенов сразу.
   */
  readonly sourceUnavailable: boolean

  /** Причина отказа источника. Показывается пользователю дословно. */
  readonly reason: string | null
}

/** Результат запроса истории. */
export interface IHistoryPage {
  readonly transfers: readonly ITransferRecord[]
  readonly limits: IHistoryLimits
}
