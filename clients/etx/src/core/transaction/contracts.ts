import type { IEventSource } from '@/core/events'
import type { Address, ChainId, TxHash } from '@/core/types'

import type {
  IFeeEstimate,
  ISignableTransaction,
  ISignedTransaction,
  IRevokeApprovalRequest,
  ITokenTransferRequest,
  ITransactionRecord,
  ITransactionRequest,
  TransactionEventMap,
  TransactionStatus,
} from './types'

/**
 * Подготовка, отправка и отслеживание транзакций.
 *
 * Сервис не подписывает: подпись выполняет `IKeyring`, единственный владелец
 * секретов. Разделение обязательно — иначе транзакционный слой получил бы
 * доступ к ключам, и периметр секретов расширился бы на весь домен.
 *
 * Все денежные величины — `bigint`. Тип `number` теряет точность за пределами
 * 2^53-1, а значения в wei доходят до 2^256-1.
 */
export interface ITransactionService extends IEventSource<TransactionEventMap> {
  /**
   * Превращает намерение пользователя в транзакцию, готовую к подписи.
   *
   * Реализация обязана:
   * 1. Получить nonce с тегом `pending`, иначе новая транзакция заменит
   *    собой ожидающую вместо постановки в очередь.
   * 2. Оценить лимит газа. Отказ оценки означает, что вызов завершится
   *    откатом, и транзакцию отправлять нельзя.
   * 3. Подставить chainId активной сети — он входит в подписываемые данные
   *    по EIP-155 и защищает подпись от проигрывания в другой сети.
   *
   * @throws GasEstimationFailedError, InsufficientFundsError
   */
  prepare(request: ITransactionRequest): Promise<ISignableTransaction>

  /**
   * Готовит перевод токена ERC-20.
   *
   * Данные вызова собирает сервис: получатель и количество лежат в них,
   * а не в полях транзакции, и кодировать их в интерфейсе значило бы
   * держать место с ценой ошибки в потерянные средства вне ядра.
   *
   * @throws InsufficientTokenBalanceError, GasEstimationFailedError,
   *         InsufficientFundsError
   */
  prepareTokenTransfer(request: ITokenTransferRequest): Promise<ISignableTransaction>

  /**
   * Готовит отзыв выданного разрешения.
   *
   * Отзыв — транзакция: разрешение живёт в контракте, и убрать его
   * можно только вызовом, который стоит газа и требует подписи.
   */
  prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<ISignableTransaction>

  /**
   * Варианты комиссии для показа пользователю.
   *
   * Возвращает несколько уровней срочности сразу: выбор между скоростью
   * и стоимостью принимает пользователь, а не кошелёк.
   */
  estimateFees(transaction: ISignableTransaction): Promise<readonly IFeeEstimate[]>

  /**
   * Публикует подписанную транзакцию и заносит её в историю.
   *
   * Принимает результат подписи, а не запрос: сервис не имеет доступа
   * к ключам и не может подписать сам.
   */
  send(signed: ISignedTransaction): Promise<TxHash>

  /** История транзакций адреса в сети, от новых к старым. */
  getHistory(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]>

  /** Отдельная запись истории. */
  getByHash(hash: TxHash): Promise<ITransactionRecord | null>

  /**
   * Формирует замещающую транзакцию с повышенной комиссией.
   *
   * Тот же nonce, повышенная цена газа. Возвращает транзакцию для подписи —
   * пользователь обязан подтвердить новую комиссию.
   *
   * @throws TransactionUnderpricedError если повышение недостаточно для узла.
   */
  prepareSpeedUp(hash: TxHash): Promise<ISignableTransaction>

  /**
   * Формирует транзакцию отмены.
   *
   * Отменить транзакцию в блокчейне нельзя. Единственный способ — вытеснить
   * её из мемпула переводом нулевой суммы самому себе с тем же nonce
   * и большей комиссией. Успех не гарантирован: исходная транзакция могла
   * быть уже включена в блок. Интерфейс обязан сообщать об этом явно.
   */
  prepareCancel(hash: TxHash): Promise<ISignableTransaction>

  /**
   * Запускает отслеживание статусов отправленных транзакций.
   *
   * Реализация обязана учитывать реорганизацию цепи: подтверждённая
   * транзакция может вернуться в состояние ожидания.
   */
  startTracking(): void

  /** Останавливает отслеживание и освобождает подписки. */
  stopTracking(): void
}

/** Долговременное хранение истории транзакций. */
export interface ITransactionRepository {
  findByAddress(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]>
  findByHash(hash: TxHash): Promise<ITransactionRecord | null>

  /** Транзакции, ожидающие подтверждения. Читаются при запуске приложения. */
  findPending(chainId: ChainId): Promise<readonly ITransactionRecord[]>

  /**
   * Транзакции, за которыми ещё нужно следить, из всех сетей.
   *
   * ЭТО НЕ ТО ЖЕ САМОЕ, ЧТО «ОЖИДАЮЩИЕ». Сюда входят и уже включённые
   * в блок записи, набравшие меньше `maxConfirmations` подтверждений:
   * блок с ними может быть вытеснен реорганизацией цепи, и перестать
   * следить за ними значило бы оставить на экране подтверждение того,
   * чего в цепи уже нет.
   *
   * Порог задаёт вызывающий: сколько подтверждений считать
   * достаточными — политика слоя транзакций, а не свойство хранилища.
   *
   * Выборка идёт по всем сетям: транзакция не перестаёт существовать
   * оттого, что пользователь переключился на другую сеть.
   */
  findUnsettled(maxConfirmations: number): Promise<readonly ITransactionRecord[]>

  save(record: ITransactionRecord): Promise<void>
  updateStatus(hash: TxHash, status: TransactionStatus): Promise<void>

  /** Удаляет историю адреса. Используется при удалении аккаунта. */
  deleteByAddress(address: Address): Promise<void>
}
