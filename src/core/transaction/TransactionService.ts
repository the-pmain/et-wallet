import {
  InsufficientFundsError,
  NetworkNotFoundError,
  TransactionNotFoundError,
  TransactionNotReplaceableError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { INetworkConfig, INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import {
  toWei,
  type Address,
  type ChainId,
  type HexString,
  type TxHash,
  type Unsubscribe,
  type Wei,
} from '@/core/types'

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

/**
 * Как часто опрашиваются отправленные транзакции.
 *
 * Близко ко времени блока Ethereum. Опрашивать чаще бессмысленно:
 * состояние меняется не быстрее блока, а лимиты публичного узла
 * расходуются на каждый вызов. В сетях с более быстрыми блоками
 * отставание составляет секунды и на решения пользователя не влияет.
 */
const TRACKING_INTERVAL_MS = 12_000

/**
 * После скольких подтверждений слежение прекращается.
 *
 * ЭТО НЕ ОКОНЧАТЕЛЬНОСТЬ, А ГРАНИЦА РАЗУМНОГО ОЖИДАНИЯ. Полной
 * невозвратности в сетях EVM нет вовсе: реорганизация возможна
 * на любой глубине, просто с быстро убывающей вероятностью. Три блока —
 * компромисс: реорганизации такой глубины после перехода Ethereum
 * на Proof-of-Stake наблюдаются исключительно редко, а бесконечный опрос
 * узла ради каждой давней транзакции стоил бы лимитов и раскрывал бы
 * активность кошелька.
 */
const CONFIRMATIONS_TO_STOP_TRACKING = 3

/**
 * Надбавка к комиссии при замене транзакции, в процентах.
 *
 * Узел принимает замену только если новая комиссия ЗАМЕТНО выше
 * прежней: у geth порог задаётся `txpool.pricebump` и по умолчанию
 * равен десяти процентам. Ровно десять брать нельзя — целочисленное
 * округление вниз даёт значение на единицу меньше порога, и узел
 * отвечает отказом «замена недооценена». Пятнадцать проходит
 * и у узлов с повышенным порогом.
 *
 * НАДБАВКА ПРИМЕНЯЕТСЯ К ОБЕИМ ЧАСТЯМ комиссии EIP-1559. Подняв
 * только предельную цену и оставив приоритетную, замену получить
 * не удастся: узел сравнивает обе.
 */
const REPLACEMENT_BUMP_PERCENT = 115n

/** Стоимость простого перевода без данных вызова. Задана стандартом. */
const SIMPLE_TRANSFER_GAS = 21_000n

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

  /* Отмена периодического опроса. `null`, пока слежение не запущено. */
  #cancelTracking: Unsubscribe | null = null

  /* Идёт проход опроса. Защищает от наложения проходов, когда узел
     отвечает медленнее, чем наступает следующий период. */
  #isTracking = false

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
      confirmations: 0,
      /* Параметры сохраняются ради ускорения: оно повторяет ТУ ЖЕ
         операцию с тем же nonce. Без данных вызова и лимита газа
         вместо ускорения ушла бы другая транзакция с тем же номером. */
      data: signed.transaction.data,
      gasLimit: signed.transaction.gasLimit,
      maxFeePerGas: signed.transaction.maxFeePerGas,
      maxPriorityFeePerGas: signed.transaction.maxPriorityFeePerGas,
      gasPrice: signed.transaction.gasPrice,
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

  /**
   * Готовит ускорение зависшей транзакции.
   *
   * ЧТО ТАКОЕ УСКОРЕНИЕ. Повторная отправка ТОЙ ЖЕ операции с тем же
   * nonce и большей комиссией. Узел заменяет прежнюю транзакцию новой,
   * потому что две с одним номером существовать не могут.
   *
   * ПОВТОРЯЕТСЯ ИМЕННО ИСХОДНАЯ ОПЕРАЦИЯ: получатель, сумма, данные
   * вызова и лимит газа берутся из сохранённой записи. Пересчитать их
   * заново значило бы отправить под тем же номером другую транзакцию —
   * пользователь ждал бы ускорения своего перевода, а получил бы
   * неизвестно что.
   *
   * @throws TransactionNotReplaceableError если транзакция уже
   *         в блоке, замещена либо её параметры не сохранены.
   */
  async prepareSpeedUp(hash: TxHash): Promise<ISignableTransaction> {
    const record = await this.#requireReplaceable(hash)

    if (record.data === null || record.gasLimit === null) {
      /* Запись сделана версией без сохранения параметров.
         Восстановить их неоткуда, а догадка означала бы отправку
         другой операции под тем же номером. */
      throw new TransactionNotReplaceableError(
        'параметры исходной транзакции не сохранены; отмена по-прежнему возможна',
      )
    }

    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)

    const transaction = await this.#buildReplacement(provider, network, record, {
      to: record.to,
      value: record.value,
      data: record.data,
      gasLimit: record.gasLimit,
    })

    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /**
   * Готовит отмену зависшей транзакции.
   *
   * ОТМЕНИТЬ ОТПРАВЛЕННУЮ ТРАНЗАКЦИЮ НЕЛЬЗЯ. Можно лишь занять её
   * номер другой, более дорогой: перевод самому себе на нулевую сумму.
   * Если узлы примут её первой, исходная операция не состоится.
   *
   * ГАРАНТИИ НЕТ, И ЭТО НУЖНО ГОВОРИТЬ ПРЯМО. Исходная транзакция
   * может попасть в блок раньше отменяющей; тогда отмена окажется
   * лишней и просто не будет принята — её номер уже израсходован.
   * Комиссия в этом случае не списывается: невключённая транзакция
   * ничего не стоит.
   *
   * ПАРАМЕТРЫ ИСХОДНОЙ ЗДЕСЬ НЕ НУЖНЫ, поэтому отмена доступна и для
   * записей, сделанных до появления замены.
   *
   * @throws TransactionNotReplaceableError если транзакция уже
   *         в блоке либо замещена.
   */
  async prepareCancel(hash: TxHash): Promise<ISignableTransaction> {
    const record = await this.#requireReplaceable(hash)
    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)

    const transaction = await this.#buildReplacement(provider, network, record, {
      /* Перевод самому себе: средства не уходят никуда, а номер
         оказывается занят. */
      to: record.from,
      value: toWei(0n),
      data: '0x' as HexString,
      /* Стоимость простого перевода. Оценивать нечего: операции нет. */
      gasLimit: SIMPLE_TRANSFER_GAS,
    })

    /* Отмена ничего не переводит, но комиссию требует, а средства
       заняты исходной транзакцией. Узел отверг бы её и сам, но по одной
       фразе о недооценке владелец не понял бы, что дело в балансе. */
    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /** Проверяет, что транзакцию ещё можно заменить. */
  async #requireReplaceable(hash: TxHash): Promise<ITransactionRecord> {
    const record = await this.#repository.findByHash(hash)

    if (record === null) {
      throw new TransactionNotFoundError(hash)
    }

    if (record.status === TRANSACTION_STATUS.Confirmed) {
      throw new TransactionNotReplaceableError('она уже включена в блок')
    }

    if (record.status === TRANSACTION_STATUS.Reverted) {
      throw new TransactionNotReplaceableError(
        'она уже включена в блок, хотя и завершилась откатом',
      )
    }

    if (record.status === TRANSACTION_STATUS.Replaced) {
      throw new TransactionNotReplaceableError('её место уже занято другой транзакцией')
    }

    return record
  }

  /**
   * Собирает замещающую транзакцию с поднятой комиссией.
   *
   * Комиссия берётся как наибольшее из двух: прежняя с надбавкой
   * и текущее предложение узла. Первое нужно, чтобы узел принял
   * замену; второе — чтобы новая транзакция не зависла так же, как
   * прежняя, если сеть подорожала.
   */
  async #buildReplacement(
    provider: IProvider,
    network: INetworkConfig,
    record: ITransactionRecord,
    payload: {
      readonly to: Address | null
      readonly value: Wei
      readonly data: HexString
      readonly gasLimit: bigint
    },
  ): Promise<ISignableTransaction> {
    const feeData = await provider.getFeeData()
    const useEip1559 = network.supportsEip1559 && feeData.maxFeePerGas !== null

    return {
      type: useEip1559 ? TRANSACTION_TYPE.Eip1559 : TRANSACTION_TYPE.Legacy,
      chainId: record.chainId,
      from: record.from,
      to: payload.to,
      value: payload.value,
      data: payload.data,
      /* ТОТ ЖЕ НОМЕР — в нём весь смысл замены. Взяв следующий
         свободный, кошелёк отправил бы вторую транзакцию вдобавок
         к зависшей, а не вместо неё. */
      nonce: record.nonce,
      gasLimit: payload.gasLimit,
      maxFeePerGas: useEip1559 ? bumped(record.maxFeePerGas, feeData.maxFeePerGas) : null,
      maxPriorityFeePerGas: useEip1559
        ? bumped(record.maxPriorityFeePerGas, feeData.maxPriorityFeePerGas)
        : null,
      gasPrice: useEip1559 ? null : bumped(record.gasPrice, feeData.gasPrice),
    }
  }

  /**
   * Начинает следить за отправленными транзакциями.
   *
   * ЧТО ИМЕННО ОТСЛЕЖИВАЕТСЯ. Каждая запись в состоянии ожидания
   * опрашивается по квитанции. Возможны четыре исхода, и все четыре
   * означают для пользователя разное:
   *
   * - квитанции нет, nonce не израсходован — транзакция ещё в мемпуле;
   * - квитанции нет, nonce уже израсходован — её место заняла другая
   *   транзакция того же отправителя. Показывать её как ожидающую
   *   значило бы обещать перевод, которого не будет;
   * - квитанция есть, выполнение успешно — операция состоялась;
   * - квитанция есть, выполнение откачено — газ списан, операция
   *   не выполнена. Это НЕ успех, и показывать её как успех нельзя.
   *
   * РЕОРГАНИЗАЦИЯ ЦЕПИ УЧТЕНА. Квитанция может исчезнуть после того,
   * как была получена: блок, содержавший транзакцию, вытеснен другим.
   * Такая запись возвращается в состояние ожидания, а не остаётся
   * подтверждённой — иначе кошелёк утверждал бы состоявшимся то, чего
   * в цепи нет.
   *
   * ОПРАШИВАЮТСЯ И УЖЕ ПОДТВЕРЖДЁННЫЕ ЗАПИСИ, пока их глубина меньше
   * порога: иначе обработка реорганизации была бы мёртвым кодом —
   * подтверждённая запись просто не попадала бы в выборку.
   *
   * ОПРАШИВАЮТСЯ ВСЕ СЕТИ, а не только активная:
   * транзакция не перестаёт существовать оттого, что пользователь
   * переключил сеть. Обычно таких сетей ноль или одна, и стоимость
   * опроса пропорциональна действительной работе.
   *
   * ПОВТОРНЫЙ ВЫЗОВ БЕЗВРЕДЕН: второй таймер не создаётся.
   */
  startTracking(): void {
    if (this.#cancelTracking !== null) {
      return
    }

    this.#cancelTracking = this.#clock.setInterval(() => {
      void this.#trackPending()
    }, TRACKING_INTERVAL_MS)

    /* Первый проход выполняется сразу: приложение могло быть закрыто
       на час, и ждать ещё период опроса, чтобы узнать судьбу перевода,
       незачем. */
    void this.#trackPending()
  }

  stopTracking(): void {
    this.#cancelTracking?.()
    this.#cancelTracking = null
  }

  /** Опрашивает все ожидающие записи по всем сетям. */
  async #trackPending(): Promise<void> {
    if (this.#isTracking) {
      /* Предыдущий проход не завершился: узел отвечает медленнее, чем
         идёт опрос. Наложение проходов удвоило бы нагрузку и могло бы
         записать устаревший результат поверх свежего. */
      return
    }

    this.#isTracking = true

    try {
      const pending = await this.#repository.findUnsettled(CONFIRMATIONS_TO_STOP_TRACKING)

      for (const record of pending) {
        try {
          await this.#refreshTracked(record)
        } catch (error) {
          /* Недоступность одной сети не имеет права остановить слежение
             за остальными. */
          this.#logger.warn('Состояние транзакции получить не удалось', {
            chainId: record.chainId,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      this.#isTracking = false
    }
  }

  /** Обновляет одну запись по данным сети. */
  async #refreshTracked(record: ITransactionRecord): Promise<void> {
    const network = this.#networks.getByChainId(record.chainId)

    if (network === null) {
      /* Сеть удалена из списка. Судить о транзакции нечем, и молча
         объявлять её потерянной нельзя. */
      return
    }

    const provider = await this.#resolver.get(network)
    const receipt = await provider.getTransactionReceipt(record.hash)

    if (receipt === null) {
      await this.#handleMissingReceipt(record, provider)

      return
    }

    const latestBlock = await provider.getBlockNumber()
    const confirmations = Math.max(1, Number(latestBlock - receipt.blockNumber) + 1)

    const status =
      receipt.status === 'success' ? TRANSACTION_STATUS.Confirmed : TRANSACTION_STATUS.Reverted

    await this.#repository.save({
      ...record,
      status,
      confirmedAt: record.confirmedAt ?? this.#clock.now(),
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      confirmations,
    })

    if (record.status !== status) {
      this.#events.emit('transaction:statusChanged', { hash: record.hash, status })
    }

    if (confirmations >= CONFIRMATIONS_TO_STOP_TRACKING) {
      /* Глубина достаточна: в следующую выборку запись не попадёт,
         и опрос по ней прекратится сам. */
      this.#logger.info('Транзакция подтверждена окончательно', {
        chainId: record.chainId,
        confirmations,
      })
    }
  }

  /**
   * Разбирает случай, когда квитанции нет.
   *
   * Отличить «ещё летит» от «место занято другой транзакцией» можно
   * по числу отправленных с адреса транзакций: если оно превысило nonce
   * нашей, значит этот nonce уже израсходован, а квитанции нет —
   * израсходован не нами.
   *
   * ХЭШ ЗАМЕЩАЮЩЕЙ ТРАНЗАКЦИИ НЕИЗВЕСТЕН, и выдумывать его нельзя:
   * найти его можно только обходом блоков, а это работа индексатора.
   * Поле остаётся пустым — пользователю сообщается сам факт.
   */
  async #handleMissingReceipt(record: ITransactionRecord, provider: IProvider): Promise<void> {
    const confirmedCount = await provider.getTransactionCount(record.from, 'latest')

    if (confirmedCount > record.nonce) {
      await this.#applyRollback(record, TRANSACTION_STATUS.Replaced)

      return
    }

    if (record.confirmations === 0) {
      /* Обычное ожидание: ничего не изменилось. */
      return
    }

    /* Запись была подтверждена, а квитанции больше нет: блок вытеснен
       реорганизацией цепи. Оставить её подтверждённой значило бы
       утверждать состоявшимся то, чего в цепи нет. */
    this.#logger.warn('Транзакция вернулась в ожидание: блок вытеснен', {
      chainId: record.chainId,
    })

    await this.#applyRollback(record, TRANSACTION_STATUS.Pending)
  }

  /** Сбрасывает сведения о включении в блок и сообщает о смене состояния. */
  async #applyRollback(record: ITransactionRecord, status: TransactionStatus): Promise<void> {
    await this.#repository.save({
      ...record,
      status,
      confirmations: 0,
      blockNumber: null,
      confirmedAt: null,
    })

    this.#events.emit('transaction:statusChanged', { hash: record.hash, status })
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

/**
 * Комиссия замещающей транзакции.
 *
 * Наибольшее из двух: прежнее значение с надбавкой и текущее
 * предложение узла. Прежнее нужно, чтобы узел принял замену, текущее —
 * чтобы новая транзакция не зависла так же, если сеть подорожала.
 *
 * Отсутствие прежнего значения не повод отказаться от замены: берётся
 * предложение узла. Ноль означал бы транзакцию, которую не примет
 * никто.
 */
function bumped(previous: bigint | null, current: bigint | null): bigint {
  const raised = previous === null ? 0n : (previous * REPLACEMENT_BUMP_PERCENT) / MULTIPLIER_BASE

  return raised > (current ?? 0n) ? raised : (current ?? 0n)
}
