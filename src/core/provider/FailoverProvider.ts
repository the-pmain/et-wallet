import { ProviderUnavailableError } from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { ILogger } from '@/core/platform'
import type { Address, BlockTag, ChainId, HexString, TxHash, Unsubscribe, Wei } from '@/core/types'

import type { IProvider } from './contracts'
import type { IRpcEndpoint } from './rpc-endpoint'
import type {
  ICallRequest,
  IGasEstimateRequest,
  IFeeData,
  ILogEntry,
  ILogFilter,
  IRpcRequest,
  ITransactionReceipt,
  ProviderEventMap,
} from './types'

const PROVIDER_NAME = 'FailoverProvider'

/**
 * Вызовы, отказ по которым говорит об умениях узла, а не о цепи.
 *
 * Только чтение: опрос соседей повторяет вызов на нескольких узлах,
 * и действие с последствиями исполнилось бы несколько раз.
 *
 * `eth_simulateV1` — новый метод, и поддержка у публичных узлов
 * разрозненная: измерено, что первый узел встроенного списка Ethereum
 * его не выполняет, а второй выполняет.
 */
const NODE_CAPABILITY_METHODS: ReadonlySet<string> = new Set(['eth_simulateV1'])

/** Подключение к одному адресу. Внедряется, чтобы не тянуть сюда транспорт. */
export type EndpointConnector = (endpoint: IRpcEndpoint, chainId: ChainId) => Promise<IProvider>

/** Уведомление о смене действующего узла. */
export type EndpointSwitchListener = (
  failed: IRpcEndpoint,
  next: IRpcEndpoint | null,
  reason: string,
) => void

/** Зависимости провайдера. */
export interface IFailoverProviderDependencies {
  readonly chainId: ChainId
  readonly endpoints: readonly IRpcEndpoint[]
  readonly connect: EndpointConnector
  readonly logger: ILogger

  /** Вызывается при исключении адреса из перебора. */
  readonly onSwitch?: EndpointSwitchListener
}

/**
 * Транспорт, переживающий отказ узла.
 *
 * ЗАЧЕМ. Перебор резервных адресов при подключении существовал и раньше,
 * но действовал ровно один раз. Узел, отказавший через минуту после
 * подключения, обрекал все последующие вызовы до конца сессии: кошелёк
 * показывал недоступность сети, имея в конфигурации два исправных
 * резервных адреса.
 *
 * ПЕРЕКЛЮЧЕНИЕ ТОЛЬКО ПРИ ОТКАЗЕ ТРАНСПОРТА. Ответ узла с ошибкой
 * JSON-RPC переключения не вызывает: узел, который ответил, работает,
 * и второй узел ответит то же самое. Различие принципиально —
 * `ProviderUnavailableError` означает «ответа не было», а `RpcError`
 * означает «ответ получен и он отрицательный».
 *
 * ВЫБОРКА ЖУРНАЛОВ ПЕРЕБОР НЕ РАСХОДУЕТ. `eth_getLogs` — единственный
 * вызов, отказ по которому не говорит о здоровье узла: узел, живой для
 * баланса и nonce, отказывает в широком поиске по журналам постоянно.
 * Такой отказ опрашивает соседние адреса временными соединениями, но
 * действующий узел не меняет. Подробности — в `getLogs`.
 *
 * ТО ЖЕ ДЛЯ ВЫЗОВОВ ИЗ `NODE_CAPABILITY_METHODS`. Они зависят от умений
 * узла, а не от состояния цепи: измерено, что узел, отдающий журналы,
 * отказывает в симуляции, и наоборот. Опрос соседей — единственный
 * способ иметь и то, и другое, не перебирая рабочий узел.
 *
 * ОТПРАВКА ТРАНЗАКЦИИ НЕ ПОВТОРЯЕТСЯ. `sendRawTransaction` при отказе
 * транспорта завершается ошибкой без попытки на другом узле. Причина
 * не в идемпотентности — повторная публикация тех же подписанных байтов
 * безопасна, — а в том, что судьба первой отправки неизвестна: узел мог
 * принять транзакцию и не успеть ответить. Второй узел вернёт
 * «already known», и кошелёк показал бы отказ по фактически принятой
 * транзакции. Пользователь обязан узнать о неопределённости, а не
 * получить придуманный за него ответ.
 *
 * ИСЧЕРПАНИЕ СПИСКА — ЭТО ОТКАЗ, А НЕ МОЛЧАНИЕ. Когда пригодных адресов
 * не осталось, вызовы завершаются `ProviderUnavailableError`.
 */
export class FailoverProvider implements IProvider {
  readonly chainId: ChainId

  readonly #endpoints: readonly IRpcEndpoint[]
  readonly #connect: EndpointConnector
  readonly #logger: ILogger
  readonly #onSwitch: EndpointSwitchListener | null
  readonly #events = new EventBus<ProviderEventMap>()

  #index = 0
  #current: IProvider | null = null
  #connecting: Promise<IProvider> | null = null
  #destroyed = false

  constructor(dependencies: IFailoverProviderDependencies) {
    this.chainId = dependencies.chainId
    this.#endpoints = dependencies.endpoints
    this.#connect = dependencies.connect
    this.#logger = dependencies.logger.child(PROVIDER_NAME)
    this.#onSwitch = dependencies.onSwitch ?? null
  }

  /** Адрес действующего узла. Пустая строка, пока соединения нет. */
  get rpcUrl(): string {
    return this.#current?.rpcUrl ?? ''
  }

  /**
   * Пригоден ли провайдер к работе.
   *
   * ИСЧЕРПАННЫЙ СПИСОК — ЭТО НЕПРИГОДНОСТЬ, А НЕ ОСОБОЕ СОСТОЯНИЕ.
   * Перебрав все адреса, объект остаётся живым, но отвечать ему нечем:
   * каждый вызов немедленно завершается отказом, не обращаясь к сети.
   * Пока такой провайдер числился действующим, `RpcManager` держал его
   * в кэше и отдавал всем желающим — кошелёк показывал «сеть
   * недоступна» при исправных узлах, и починить это до перезагрузки
   * было нечем.
   *
   * Признавшись в непригодности, провайдер позволяет `RpcManager`
   * выбросить его и собрать новый: тот заново прочитает список адресов
   * и учтёт истёкшие выдержки.
   */
  get isActive(): boolean {
    return !this.#destroyed && this.#index < this.#endpoints.length
  }

  /** Действующий адрес с указанием источника. `null`, пока соединения нет. */
  get activeEndpoint(): IRpcEndpoint | null {
    return this.#current === null ? null : (this.#endpoints[this.#index] ?? null)
  }

  /**
   * Произвольный вызов JSON-RPC.
   *
   * МЕТОДЫ ИЗ `NODE_CAPABILITY_METHODS` ПРИ ОТКАЗЕ СПРАШИВАЮТСЯ
   * У СОСЕДЕЙ. Причина та же, что у журналов: отказ означает не
   * состояние цепи, а умения узла, и у соседа ответ может быть другим.
   * Измерено на живых узлах: шлюз, отдающий журналы, отказывает
   * в симуляции, а узел, выполняющий симуляцию, не отдаёт журналов.
   * Без опроса соседей одно из двух всегда оставалось бы недоступным.
   *
   * Действующий узел при этом не меняется: он исправен, просто
   * не умеет именно этого.
   */
  async request<TResult>(request: IRpcRequest): Promise<TResult> {
    if (!NODE_CAPABILITY_METHODS.has(request.method)) {
      return await this.#withFailover((provider) => provider.request<TResult>(request))
    }

    let firstError: unknown

    try {
      return await (await this.#ensureConnected()).request<TResult>(request)
    } catch (error) {
      firstError = error
    }

    return await this.#askElsewhere((provider) => provider.request<TResult>(request), firstError)
  }

  async getChainId(): Promise<ChainId> {
    return await this.#withFailover((provider) => provider.getChainId())
  }

  async getBlockNumber(): Promise<bigint> {
    return await this.#withFailover((provider) => provider.getBlockNumber())
  }

  async getBalance(address: Address, blockTag?: BlockTag): Promise<Wei> {
    return await this.#withFailover((provider) => provider.getBalance(address, blockTag))
  }

  async getTransactionCount(address: Address, blockTag?: BlockTag): Promise<number> {
    return await this.#withFailover((provider) => provider.getTransactionCount(address, blockTag))
  }

  async getNonce(address: Address): Promise<number> {
    return await this.#withFailover((provider) => provider.getNonce(address))
  }

  async call(request: ICallRequest, blockTag?: BlockTag): Promise<HexString> {
    return await this.#withFailover((provider) => provider.call(request, blockTag))
  }

  async getCode(address: Address, blockTag?: BlockTag): Promise<HexString> {
    return await this.#withFailover((provider) => provider.getCode(address, blockTag))
  }

  async estimateGas(request: IGasEstimateRequest): Promise<bigint> {
    return await this.#withFailover((provider) => provider.estimateGas(request))
  }

  async getFeeData(): Promise<IFeeData> {
    return await this.#withFailover((provider) => provider.getFeeData())
  }

  /**
   * Публикует подписанную транзакцию БЕЗ повтора на другом узле.
   *
   * Обоснование — в описании класса.
   */
  async sendRawTransaction(signedTransaction: HexString): Promise<TxHash> {
    const provider = await this.#ensureConnected()

    return await provider.sendRawTransaction(signedTransaction)
  }

  async getTransactionReceipt(hash: TxHash): Promise<ITransactionReceipt | null> {
    return await this.#withFailover((provider) => provider.getTransactionReceipt(hash))
  }

  /**
   * Выборка журналов: спрашивает соседей, но НЕ исключает действующий узел.
   *
   * ПОЧЕМУ ЭТОТ ВЫЗОВ ОБРАБОТАН ОТДЕЛЬНО ОТ ВСЕХ ПРОЧИХ. `eth_getLogs`
   * на порядок тяжелее остальных запросов, и отказ по нему означает не
   * то же самое, что отказ по балансу. Измерено на живых узлах: при
   * поиске истории `eth.drpc.org` ответил «408 Request Timeout», а
   * `ethereum-rpc.publicnode.com` — «403: архивные запросы требуют
   * личного токена». Оба узла в ту же секунду исправно отдавали баланс,
   * номер блока и nonce.
   *
   * Отсюда правило: отказ на журналах — приговор запросу, а не узлу.
   * Пропусти мы его через общий перебор, каждый заход в историю
   * вычёркивал бы по узлу, и после двух заходов кошелёк остался бы
   * вовсе без соединения — без балансов и без отправки. Это наблюдалось
   * живьём: экран истории сообщал «нет доступных адресов», не сделав
   * ни одного запроса, потому что список был исчерпан заранее.
   *
   * Поэтому здесь: действующий узел спрашивается первым и остаётся
   * действующим при любом исходе, а при отказе опрашиваются остальные
   * адреса — временными соединениями, не трогая перебор.
   *
   * ЦЕНА, КОТОРУЮ НАДО ЗНАТЬ. Второй узел узнаёт тот же запрос: адрес
   * владельца и набор тем. Расплата ограничена — опрос идёт только
   * после отказа и только по уже настроенным адресам, — но операторов,
   * видящих запрос, становится больше одного.
   */
  async getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    let firstError: unknown

    try {
      return await (await this.#ensureConnected()).getLogs(filter)
    } catch (error) {
      firstError = error
    }

    return await this.#askElsewhere((provider) => provider.getLogs(filter), firstError)
  }

  destroy(): void {
    this.#destroyed = true
    this.#current?.destroy()
    this.#current = null
    this.#connecting = null
  }

  on<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Выполняет вызов, переключаясь на следующий адрес при отказе транспорта.
   *
   * Каждый адрес пробуется не более одного раза за вызов: повтор на уже
   * отказавшем адресе только удлинил бы ожидание.
   */
  async #withFailover<TResult>(call: (provider: IProvider) => Promise<TResult>): Promise<TResult> {
    let lastError: unknown = null

    while (this.#index < this.#endpoints.length) {
      const endpoint = this.#endpoints[this.#index] as IRpcEndpoint

      try {
        return await call(await this.#ensureConnected())
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) {
          /* Узел ответил, и ответ отрицательный. Другой узел ответит
             то же самое: недостаток средств и откат вызова не зависят
             от того, кого спрашивать. */
          throw error
        }

        lastError = error
        this.#rotate(endpoint, error.message)
      }
    }

    throw new ProviderUnavailableError(this.chainId, { cause: lastError })
  }

  /**
   * Опрашивает остальные адреса, не меняя действующий узел.
   *
   * Соединения здесь временные и закрываются сразу: это разовый вопрос
   * соседу, а не смена рабочего канала. Порядок обхода — порядок списка,
   * действующий адрес пропускается: его уже спросили.
   *
   * ГОДИТСЯ ТОЛЬКО ДЛЯ ЧТЕНИЯ. Вызов уходит нескольким узлам, и
   * действие с последствиями — отправка транзакции — так исполнилось
   * бы несколько раз.
   *
   * @throws Исходную ошибку, если ни один сосед не ответил. Наружу
   *         обязана уйти именно она: ошибка последнего опрошенного узла
   *         рассказывала бы о случайном соседе вместо того узла, с
   *         которым кошелёк работает.
   */
  async #askElsewhere<TResult>(
    call: (provider: IProvider) => Promise<TResult>,
    firstError: unknown,
  ): Promise<TResult> {
    for (const [index, endpoint] of this.#endpoints.entries()) {
      if (index === this.#index || this.#destroyed) {
        continue
      }

      let probe: IProvider

      try {
        probe = await this.#connect(endpoint, this.chainId)
      } catch {
        /* Сосед недоступен. Действующий узел это не затрагивает. */
        continue
      }

      try {
        return await call(probe)
      } catch {
        /* Сосед тоже отказал. Это ожидаемый исход, а не происшествие:
           публичные узлы отказывают в широком поиске сплошь и рядом.
           В журнал не пишем — строка на каждый заход в историю
           превратилась бы в шум, а причину покажет исходная ошибка. */
        continue
      } finally {
        probe.destroy()
      }
    }

    throw firstError
  }

  /** Возвращает действующее соединение, устанавливая его при необходимости. */
  async #ensureConnected(): Promise<IProvider> {
    if (this.#destroyed) {
      throw new ProviderUnavailableError(this.chainId)
    }

    if (this.#current !== null && this.#current.isActive) {
      return this.#current
    }

    /* Параллельные вызовы разделяют одно подключение: экран, запросивший
       баланс и nonce одновременно, иначе открыл бы два соединения. */
    this.#connecting ??= this.#connectFromCurrentIndex()

    try {
      return await this.#connecting
    } finally {
      this.#connecting = null
    }
  }

  /**
   * Подключается, перебирая адреса начиная с текущего.
   *
   * @throws ProviderUnavailableError если пригодных адресов не осталось.
   */
  async #connectFromCurrentIndex(): Promise<IProvider> {
    let lastError: unknown = null

    while (this.#index < this.#endpoints.length) {
      const endpoint = this.#endpoints[this.#index] as IRpcEndpoint

      try {
        const provider = await this.#connect(endpoint, this.chainId)

        this.#current = provider

        return provider
      } catch (error) {
        lastError = error
        this.#rotate(endpoint, error instanceof Error ? error.message : String(error))
      }
    }

    throw new ProviderUnavailableError(this.chainId, { cause: lastError })
  }

  /** Исключает текущий адрес и переходит к следующему. */
  #rotate(failed: IRpcEndpoint, reason: string): void {
    this.#current?.destroy()
    this.#current = null
    this.#index += 1

    const next = this.#endpoints[this.#index] ?? null

    /* В журнал уходит идентификатор источника, но НЕ адрес. Адрес узла
       Alchemy содержит ключ API, а адрес собственного узла пользователя —
       ключ его учётной записи либо расположение машины. Журнал попадает
       в отчёты об ошибках и в консоль браузера. */
    this.#logger.warn('The node was excluded from the rotation', {
      providerId: failed.providerId,
      hasReplacement: next !== null,
      reason,
    })

    this.#onSwitch?.(failed, next, reason)
  }
}
