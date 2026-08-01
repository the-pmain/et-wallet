import { InsufficientFundsError, NetworkNotFoundError, NotImplementedError } from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { Address, ChainId, HexString, TxHash, Unsubscribe, Wei } from '@/core/types'

import type { ITransactionRepository, ITransactionService } from './contracts'
import {
  FEE_PRIORITY,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type FeePriority,
  type IFeeEstimate,
  type ISignableTransaction,
  type ISignedTransaction,
  type ITransactionRecord,
  type ITransactionRequest,
  type TransactionEventMap,
  type TransactionStatus,
} from './types'

const SERVICE_NAME = 'TransactionService'

/**
 * Надбавки к приоритетной комиссии по уровням срочности.
 *
 * Значения относительно предложенного узлом: узел уже учитывает текущую
 * загрузку сети, и назначать абсолютные величины значило бы игнорировать
 * её. Уровень «низкий» не опускается ниже предложенного — заниженная
 * комиссия оборачивается транзакцией, висящей в мемпуле часами.
 */
const PRIORITY_MULTIPLIER: Readonly<Record<Exclude<FeePriority, 'custom'>, bigint>> = {
  [FEE_PRIORITY.Low]: 100n,
  [FEE_PRIORITY.Medium]: 125n,
  [FEE_PRIORITY.High]: 175n,
}

/** Делитель для процентных надбавок выше. */
const MULTIPLIER_BASE = 100n

/**
 * Запас лимита газа сверх оценки, в процентах.
 *
 * Оценка выполняется на состоянии текущего блока, а транзакция попадёт
 * в следующий: состояние контракта успеет измениться, и точный лимит
 * может не хватить. Неизрасходованный газ возвращается, а нехватка
 * приводит к откату со списанием — запас дешевле.
 */
const GAS_LIMIT_HEADROOM = 120n

/** Зависимости сервиса. */
export interface ITransactionServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly repository: ITransactionRepository
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Подготовка, отправка и хранение транзакций.
 *
 * СЕРВИС НЕ ПОДПИСЫВАЕТ. Подпись выполняет владелец ключей —
 * `AccountManager`. Разделение обязательно: иначе транзакционный слой
 * получил бы доступ к секретам, и периметр их хранения расширился бы
 * на весь домен.
 *
 * `prepare` ВОЗВРАЩАЕТ РОВНО ТО, ЧТО БУДЕТ ПОДПИСАНО. Экран подтверждения
 * показывает поля этого объекта, и он же уходит в подпись. Пересчёт
 * значений между показом и подписью недопустим: расхождение показанного
 * с подписанным — основной класс атак на интерфейс кошелька.
 */
export class TransactionService implements ITransactionService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #repository: ITransactionRepository
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #events = new EventBus<TransactionEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Сбой обработчика транзакционного события', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  constructor(dependencies: ITransactionServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#repository = dependencies.repository
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  /**
   * Превращает намерение пользователя в транзакцию, готовую к подписи.
   *
   * ПОРЯДОК ДЕЙСТВИЙ ЗНАЧИМ.
   *
   * 1. Nonce берётся с учётом мемпула. Значение без учёта ожидающих
   *    транзакций заставило бы новую заменить собой предыдущую вместо
   *    постановки в очередь — прежний перевод молча исчез бы.
   *
   * 2. Лимит газа оценивается обращением к узлу. Отказ оценки означает,
   *    что вызов завершится откатом: газ спишется, а операция не
   *    выполнится. Назначать лимит произвольно в этом случае нельзя.
   *
   * 3. Достаточность средств проверяется здесь, а не в интерфейсе.
   *    Проверка в форме забывается при появлении второго пути отправки;
   *    здесь её не обойти.
   *
   * @throws GasEstimationFailedError, InsufficientFundsError,
   *         ProviderUnavailableError, NetworkNotFoundError
   */
  async prepare(request: ITransactionRequest): Promise<ISignableTransaction> {
    const network = this.#requireNetwork(request)
    const provider = await this.#resolver.get(network)

    const nonce = request.nonce ?? (await provider.getNonce(request.from))
    const gasLimit = request.gasLimit ?? (await this.#estimateGasLimit(provider, request))
    const feeData = await provider.getFeeData()

    /* Тип определяется поддержкой сети И наличием данных у узла:
       сеть может заявлять EIP-1559, а узел не сообщать базовую
       комиссию — тогда транзакция второго типа будет отвергнута. */
    const useEip1559 = network.supportsEip1559 && feeData.maxFeePerGas !== null

    const transaction: ISignableTransaction = {
      type: useEip1559 ? TRANSACTION_TYPE.Eip1559 : TRANSACTION_TYPE.Legacy,
      chainId: network.chainId,
      from: request.from,
      to: request.to,
      value: request.value,
      data: request.data ?? ('0x' as HexString),
      nonce,
      gasLimit,
      maxFeePerGas: useEip1559 ? feeData.maxFeePerGas : null,
      maxPriorityFeePerGas: useEip1559 ? feeData.maxPriorityFeePerGas : null,
      gasPrice: useEip1559 ? null : (feeData.gasPrice ?? 0n),
    }

    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /**
   * Варианты комиссии для показа пользователю.
   *
   * Возвращаются три уровня сразу: выбор между скоростью и стоимостью
   * принимает пользователь, а не кошелёк.
   *
   * ОЖИДАЕМОЕ ВРЕМЯ НЕ СООБЩАЕТСЯ. Оно зависит от загрузки сети в момент
   * включения в блок, которую предсказать нельзя. Показать выдуманное
   * число значило бы дать обещание, за которое кошелёк не отвечает.
   */
  estimateFees(transaction: ISignableTransaction): Promise<readonly IFeeEstimate[]> {
    const levels: Exclude<FeePriority, 'custom'>[] = [
      FEE_PRIORITY.Low,
      FEE_PRIORITY.Medium,
      FEE_PRIORITY.High,
    ]

    return Promise.resolve(levels.map((priority) => this.#scaleFee(transaction, priority)))
  }

  /** Применяет транзакции выбранный уровень комиссии. */
  applyFee(transaction: ISignableTransaction, fee: IFeeEstimate): ISignableTransaction {
    return {
      ...transaction,
      gasLimit: fee.gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      gasPrice: fee.gasPrice,
    }
  }

  /**
   * Публикует подписанную транзакцию и заносит её в историю.
   *
   * ЗАПИСЬ СОХРАНЯЕТСЯ ПОСЛЕ УСПЕШНОЙ ПУБЛИКАЦИИ. Сохранение до неё
   * оставило бы в истории транзакцию, которой в сети нет, и пользователь
   * ждал бы подтверждения того, что никуда не отправлено.
   *
   * ОТКАЗ ТРАНСПОРТА НЕ ПРЕВРАЩАЕТСЯ В ПОВТОР. Судьба отправки при таком
   * отказе неизвестна: узел мог принять транзакцию и не успеть ответить.
   * Решение принимает пользователь, увидев причину, а не кошелёк молча.
   */
  async send(signed: ISignedTransaction): Promise<TxHash> {
    const network = this.#requireNetwork({ chainId: signed.transaction.chainId })
    const provider = await this.#resolver.get(network)
    const hash = await provider.sendRawTransaction(signed.raw)

    const record: ITransactionRecord = {
      hash,
      chainId: signed.transaction.chainId,
      from: signed.transaction.from,
      to: signed.transaction.to,
      value: signed.transaction.value,
      nonce: signed.transaction.nonce,
      status: TRANSACTION_STATUS.Pending,
      type: signed.transaction.type,
      submittedAt: this.#clock.now(),
      confirmedAt: null,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      replacedBy: null,
    }

    await this.#repository.save(record)

    this.#logger.info('Транзакция опубликована', { chainId: signed.transaction.chainId })
    this.#events.emit('transaction:submitted', { record })

    return hash
  }

  async getHistory(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    return await this.#repository.findByAddress(address, chainId)
  }

  async getByHash(hash: TxHash): Promise<ITransactionRecord | null> {
    return await this.#repository.findByHash(hash)
  }

  /**
   * Обновляет состояние отправленной транзакции по квитанции.
   *
   * Вызывается интерфейсом после отправки. Полноценное отслеживание
   * с учётом реорганизации цепи — предмет отдельного этапа.
   */
  async refreshStatus(hash: TxHash): Promise<TransactionStatus | null> {
    const record = await this.#repository.findByHash(hash)

    if (record === null) {
      return null
    }

    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)
    const receipt = await provider.getTransactionReceipt(hash)

    if (receipt === null) {
      return TRANSACTION_STATUS.Pending
    }

    /* Включённая в блок транзакция могла завершиться откатом: газ списан,
       операция не выполнена. Показывать такую как успешную нельзя. */
    const status =
      receipt.status === 'success' ? TRANSACTION_STATUS.Confirmed : TRANSACTION_STATUS.Reverted

    await this.#repository.save({
      ...record,
      status,
      confirmedAt: this.#clock.now(),
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
    })

    this.#events.emit('transaction:statusChanged', { hash, status })

    return status
  }

  prepareSpeedUp(_hash: TxHash): Promise<ISignableTransaction> {
    return Promise.reject(new NotImplementedError(`${SERVICE_NAME}.prepareSpeedUp`))
  }

  prepareCancel(_hash: TxHash): Promise<ISignableTransaction> {
    return Promise.reject(new NotImplementedError(`${SERVICE_NAME}.prepareCancel`))
  }

  startTracking(): void {
    /* Отслеживание с учётом реорганизации цепи — предмет отдельного
       этапа. Пустая реализация честнее исключения: вызывающий код
       не обязан знать, что слежения ещё нет. */
  }

  stopTracking(): void {
    /* См. `startTracking`. */
  }

  on<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Оценивает лимит газа с запасом.
   *
   * Отказ оценки не перехватывается: он означает, что вызов завершится
   * откатом, и отправлять транзакцию нельзя. Подставить произвольный
   * лимит значило бы гарантированно сжечь газ впустую.
   */
  async #estimateGasLimit(provider: IProvider, request: ITransactionRequest): Promise<bigint> {
    if (request.to === null) {
      /* Развёртывание контракта: получателя нет, оценка выполняется
         по данным вызова. */
      const estimate = await provider.estimateGas({
        to: request.from,
        from: request.from,
        data: request.data ?? ('0x' as HexString),
        value: request.value,
      })

      return (estimate * GAS_LIMIT_HEADROOM) / MULTIPLIER_BASE
    }

    const estimate = await provider.estimateGas({
      to: request.to,
      from: request.from,
      data: request.data ?? ('0x' as HexString),
      value: request.value,
    })

    return (estimate * GAS_LIMIT_HEADROOM) / MULTIPLIER_BASE
  }

  /**
   * Проверяет, хватит ли средств на перевод вместе с комиссией.
   *
   * Считается по ВЕРХНЕЙ границе комиссии, а не по ожидаемой: списано
   * будет меньше, но узел проверяет именно верхнюю границу и отвергнет
   * транзакцию, если её не покрывает баланс.
   */
  async #assertSufficientFunds(
    provider: IProvider,
    transaction: ISignableTransaction,
  ): Promise<void> {
    const balance = await provider.getBalance(transaction.from)
    const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
    const required = transaction.value + transaction.gasLimit * feePerGas

    if (required > balance) {
      throw new InsufficientFundsError(required, balance)
    }
  }

  /** Пересчитывает комиссию под уровень срочности. */
  #scaleFee(
    transaction: ISignableTransaction,
    priority: Exclude<FeePriority, 'custom'>,
  ): IFeeEstimate {
    const multiplier = PRIORITY_MULTIPLIER[priority]

    if (transaction.type === TRANSACTION_TYPE.Eip1559) {
      const tip = ((transaction.maxPriorityFeePerGas ?? 0n) * multiplier) / MULTIPLIER_BASE
      const base = (transaction.maxFeePerGas ?? 0n) - (transaction.maxPriorityFeePerGas ?? 0n)
      const maxFeePerGas = base + tip

      return {
        priority,
        maxFeePerGas,
        maxPriorityFeePerGas: tip,
        gasPrice: null,
        gasLimit: transaction.gasLimit,
        maxCost: (transaction.gasLimit * maxFeePerGas) as Wei,
        estimatedSeconds: null,
      }
    }

    const gasPrice = ((transaction.gasPrice ?? 0n) * multiplier) / MULTIPLIER_BASE

    return {
      priority,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      gasPrice,
      gasLimit: transaction.gasLimit,
      maxCost: (transaction.gasLimit * gasPrice) as Wei,
      estimatedSeconds: null,
    }
  }

  #requireNetwork(request: { chainId?: ChainId }) {
    const chainId = request.chainId ?? this.#networks.getActive().chainId
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return network
  }
}
