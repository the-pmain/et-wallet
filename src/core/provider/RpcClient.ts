import { FetchRequest, JsonRpcProvider, Network, type JsonRpcApiProvider } from 'ethers'

import { toAddress } from '@/core/address'
import { EventBus, type EventListener } from '@/core/events'
import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import {
  parseChainIdFromHex,
  toBlockHash,
  toChainId,
  toTxHash,
  type Address,
  type BlockTag,
  type ChainId,
  type HexString,
  type TxHash,
  type Unsubscribe,
  type Wei,
} from '@/core/types'

import type { IProvider } from './contracts'
import { mapProviderError } from './error-mapping'
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

/**
 * Предельное время ожидания ответа узла.
 *
 * Без ограничения зависший узел подвесил бы кошелёк: пользователь увидел
 * бы бесконечную загрузку вместо предложения сменить сеть. Тридцать секунд
 * с запасом покрывают медленную мобильную сеть и при этом не выглядят
 * как зависание.
 */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Периодичность опроса новых блоков.
 *
 * Применяется только при наличии подписчиков: ethers не опрашивает узел,
 * пока никто не слушает события. Четыре секунды примерно соответствуют
 * времени блока Ethereum и не расходуют лимиты публичных узлов зря.
 */
const DEFAULT_POLLING_INTERVAL_MS = 4_000

/** Настройки соединения. */
export interface IRpcClientOptions {
  readonly timeoutMs?: number
  readonly pollingIntervalMs?: number
}

/**
 * Транспорт к узлу поверх ethers v6.
 *
 * ЕДИНСТВЕННОЕ место в приложении, знающее о существовании ethers.
 * Домен зависит от `IProvider`, поэтому замена библиотеки затрагивает
 * только этот файл и отображение ошибок.
 *
 * ЧТО ДЕЛАЕТСЯ ПРИ ПОДКЛЮЧЕНИИ:
 *
 * 1. Запрашивается `eth_chainId` и сверяется с ожидаемым значением.
 *    Несовпадение — отказ и разрыв соединения. Узел, обслуживающий другую
 *    сеть, заставил бы кошелёк подписать транзакцию, пригодную для
 *    повторного проигрывания в целевой сети.
 *
 * 2. Сеть фиксируется параметром `staticNetwork`. Без него ethers
 *    периодически перезапрашивает chainId и МОЛЧА следует за узлом,
 *    если тот сменил сеть. Для кошелька такое поведение недопустимо:
 *    смена сети обязана быть решением пользователя.
 */
export class RpcClient implements IProvider {
  readonly chainId: ChainId
  readonly rpcUrl: string

  readonly #provider: JsonRpcApiProvider
  readonly #events = new EventBus<ProviderEventMap>()

  #active = true
  #blockListener: ((blockNumber: number) => void) | null = null

  private constructor(provider: JsonRpcApiProvider, chainId: ChainId, rpcUrl: string) {
    this.#provider = provider
    this.chainId = chainId
    this.rpcUrl = rpcUrl
  }

  /**
   * Устанавливает соединение с узлом по HTTP.
   *
   * @throws ProviderUnavailableError если узел не отвечает.
   * @throws ChainIdMismatchError если узел обслуживает другую сеть.
   */
  static async connect(
    rpcUrl: string,
    expectedChainId: ChainId,
    options: IRpcClientOptions = {},
  ): Promise<RpcClient> {
    const request = new FetchRequest(rpcUrl)
    request.timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const provider = new JsonRpcProvider(request, Network.from(Number(expectedChainId)), {
      /* Сеть зафиксирована: ethers не станет перезапрашивать chainId
         и не последует за узлом, сменившим сеть. */
      staticNetwork: Network.from(Number(expectedChainId)),
      pollingInterval: options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
    })

    return await RpcClient.attach(provider, expectedChainId, rpcUrl)
  }

  /**
   * Оборачивает готовый провайдер ethers.
   *
   * Точка расширения для нестандартных транспортов — WebSocket, IPC,
   * внутренний провайдер расширения. Сверка chainId выполняется так же,
   * как при обычном подключении.
   */
  static async attach(
    provider: JsonRpcApiProvider,
    expectedChainId: ChainId,
    rpcUrl: string,
  ): Promise<RpcClient> {
    const client = new RpcClient(provider, expectedChainId, rpcUrl)

    try {
      await client.#verifyChainId()
    } catch (error) {
      client.destroy()
      throw error
    }

    client.#events.emit('provider:connected', { chainId: expectedChainId, rpcUrl })

    return client
  }

  get isActive(): boolean {
    return this.#active
  }

  async request<TResult>(request: IRpcRequest): Promise<TResult> {
    return await this.#call(async () => {
      return (await this.#provider.send(request.method, [...(request.params ?? [])])) as TResult
    })
  }

  async getChainId(): Promise<ChainId> {
    /* Ответ узла недоверенный: разбор выполняется валидирующим
       конструктором, а не приведением типа. */
    return parseChainIdFromHex(await this.request<unknown>({ method: 'eth_chainId' }))
  }

  async getBlockNumber(): Promise<bigint> {
    return await this.#call(async () => BigInt(await this.#provider.getBlockNumber()))
  }

  async getBalance(address: Address, blockTag?: BlockTag): Promise<Wei> {
    return await this.#call(async () => {
      const balance = await this.#provider.getBalance(
        address,
        RpcClient.#toEthersBlockTag(blockTag),
      )

      return balance as Wei
    })
  }

  async getTransactionCount(address: Address, blockTag?: BlockTag): Promise<number> {
    return await this.#call(
      async () =>
        await this.#provider.getTransactionCount(address, RpcClient.#toEthersBlockTag(blockTag)),
    )
  }

  async getNonce(address: Address): Promise<number> {
    /* Тег `pending` зашит намеренно и не выносится в параметр: значение
       по умолчанию (`latest`) не учитывает транзакции в мемпуле, и новая
       транзакция заменила бы собой ожидающую. Ошибка молчаливая —
       пользователь обнаружит её по пропавшему переводу. */
    return await this.getTransactionCount(address, 'pending')
  }

  async call(request: ICallRequest, blockTag?: BlockTag): Promise<HexString> {
    return await this.#call(async () => {
      const tag = RpcClient.#toEthersBlockTag(blockTag)
      const result = await this.#provider.call({
        ...RpcClient.#toEthersTransaction(request),
        ...(tag === undefined ? {} : { blockTag: tag }),
      })

      return result as HexString
    })
  }

  async getCode(address: Address, blockTag?: BlockTag): Promise<HexString> {
    return await this.#call(async () => {
      const tag = RpcClient.#toEthersBlockTag(blockTag)
      const code = await this.#provider.getCode(address, tag)

      return code as HexString
    })
  }

  async estimateGas(request: IGasEstimateRequest): Promise<bigint> {
    return await this.#call(
      async () => await this.#provider.estimateGas(RpcClient.#toEstimateRequest(request)),
    )
  }

  async getFeeData(): Promise<IFeeData> {
    return await this.#call(async () => {
      const data = await this.#provider.getFeeData()

      return {
        baseFeePerGas: RpcClient.#deriveBaseFee(data.maxFeePerGas, data.maxPriorityFeePerGas),
        maxFeePerGas: data.maxFeePerGas,
        maxPriorityFeePerGas: data.maxPriorityFeePerGas,
        gasPrice: data.gasPrice,
      }
    })
  }

  async sendRawTransaction(signedTransaction: HexString): Promise<TxHash> {
    /* Прямой вызов JSON-RPC вместо `broadcastTransaction` из ethers.
       Тот дополнительно запрашивает номер блока и собирает объект ответа
       с методами ожидания подтверждения — лишний обход к узлу на каждую
       отправку. Кошельку нужен только хэш: отслеживанием статуса
       занимается транзакционный слой по собственному расписанию.

       Хэш проходит валидирующий конструктор: ответ узла недоверенный,
       а некорректное значение попало бы в историю операций и в ссылку
       на обозреватель блоков. */
    return await this.#call(async () =>
      toTxHash(await this.#provider.send('eth_sendRawTransaction', [signedTransaction])),
    )
  }

  async getTransactionReceipt(hash: TxHash): Promise<ITransactionReceipt | null> {
    return await this.#call(async () => {
      const receipt = await this.#provider.getTransactionReceipt(hash)

      if (receipt === null) {
        return null
      }

      return {
        transactionHash: toTxHash(receipt.hash),
        blockNumber: BigInt(receipt.blockNumber),
        blockHash: toBlockHash(receipt.blockHash),
        from: toAddress(receipt.from),
        to: receipt.to === null ? null : toAddress(receipt.to),
        /* Транзакция, включённая в блок, могла завершиться откатом.
           Газ при этом списан, и показывать её успешной нельзя. */
        status: receipt.status === 1 ? 'success' : 'reverted',
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.gasPrice,
        contractAddress:
          receipt.contractAddress === null ? null : toAddress(receipt.contractAddress),
        logs: receipt.logs.map((log) => RpcClient.#toLogEntry(log)),
      }
    })
  }

  async getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    return await this.#call(async () => {
      const logs = await this.#provider.getLogs({
        ...(filter.address === undefined ? {} : { address: filter.address }),
        ...(filter.topics === undefined ? {} : { topics: [...filter.topics] }),
        ...(filter.fromBlock === undefined ? {} : { fromBlock: Number(filter.fromBlock) }),
        ...(filter.toBlock === undefined ? {} : { toBlock: Number(filter.toBlock) }),
      })

      return logs.map((log) => RpcClient.#toLogEntry(log))
    })
  }

  destroy(): void {
    if (!this.#active) {
      return
    }

    this.#active = false
    this.#stopBlockPolling()
    this.#provider.destroy()
    this.#events.emit('provider:disconnected', {
      chainId: this.chainId,
      reason: 'the connection was closed by the caller',
    })
    this.#events.removeAllListeners()
  }

  on<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    const unsubscribe = this.#events.on(event, listener)

    if (event === 'provider:block') {
      this.#startBlockPolling()
    }

    return () => {
      unsubscribe()
      this.#stopBlockPollingIfIdle()
    }
  }

  once<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    const unsubscribe = this.#events.once(event, listener)

    if (event === 'provider:block') {
      this.#startBlockPolling()
    }

    return () => {
      unsubscribe()
      this.#stopBlockPollingIfIdle()
    }
  }

  off<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
    this.#stopBlockPollingIfIdle()
  }

  /**
   * Сверяет chainId узла с ожидаемым.
   *
   * Самая важная проверка транспорта. Узел, обслуживающий другую сеть,
   * вернёт чужие балансы и чужой nonce, а подпись, созданная по его
   * данным, окажется пригодной для проигрывания в целевой сети.
   */
  async #verifyChainId(): Promise<void> {
    const actual = await this.getChainId()

    if (actual !== this.chainId) {
      throw new ChainIdMismatchError(this.chainId, actual)
    }
  }

  /**
   * Оборачивает вызов к узлу: проверяет состояние и отображает ошибки.
   *
   * Проверка активности обязательна: обращение к уничтоженному провайдеру
   * ethers даёт невнятную внутреннюю ошибку вместо понятного отказа.
   */
  async #call<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    if (!this.#active) {
      throw new ProviderUnavailableError(this.chainId)
    }

    try {
      return await operation()
    } catch (error) {
      throw mapProviderError(error, this.chainId)
    }
  }

  #startBlockPolling(): void {
    if (this.#blockListener !== null || !this.#active) {
      return
    }

    this.#blockListener = (blockNumber: number) => {
      this.#events.emit('provider:block', { blockNumber: BigInt(blockNumber) })
    }

    void this.#provider.on('block', this.#blockListener)
  }

  /** Прекращает опрос, когда подписчиков на новые блоки не осталось. */
  #stopBlockPollingIfIdle(): void {
    if (this.#events.listenerCount('provider:block') === 0) {
      this.#stopBlockPolling()
    }
  }

  #stopBlockPolling(): void {
    if (this.#blockListener === null) {
      return
    }

    void this.#provider.off('block', this.#blockListener)
    this.#blockListener = null
  }

  /**
   * Восстанавливает базовую комиссию блока.
   *
   * ethers не возвращает `baseFeePerGas` в составе данных о комиссии,
   * но вычисляет `maxFeePerGas` как `baseFee * 2 + priorityFee`.
   * Обратное преобразование даёт оценку базовой комиссии без
   * дополнительного запроса к узлу.
   *
   * Это ОЦЕНКА, а не точное значение из заголовка блока. Для показа
   * пользователю пригодна, для расчёта комиссии — используйте
   * `maxFeePerGas` напрямую.
   */
  static #deriveBaseFee(maxFeePerGas: bigint | null, priorityFee: bigint | null): bigint | null {
    if (maxFeePerGas === null || priorityFee === null) {
      return null
    }

    const doubled = maxFeePerGas - priorityFee

    return doubled > 0n ? doubled / 2n : null
  }

  static #toEthersBlockTag(blockTag?: BlockTag): string | number | undefined {
    if (blockTag === undefined) {
      return undefined
    }

    return typeof blockTag === 'bigint' ? Number(blockTag) : blockTag
  }

  /**
   * Готовит запрос оценки газа.
   *
   * ПОЛЕ `to` ОПУСКАЕТСЯ ЦЕЛИКОМ, а не заполняется чем-нибудь. Именно
   * его отсутствие означает для узла развёртывание контракта; подстановка
   * адреса отправителя дала бы оценку простого перевода самому себе —
   * величину, которой не хватит на развёртывание, и транзакция
   * завершилась бы откатом со списанием газа.
   */
  static #toEstimateRequest(request: IGasEstimateRequest): {
    to?: string
    from?: string
    data?: string
    value?: bigint
  } {
    return {
      ...(request.to === null ? {} : { to: request.to }),
      ...(request.from === undefined ? {} : { from: request.from }),
      ...(request.data === undefined ? {} : { data: request.data }),
      ...(request.value === undefined ? {} : { value: request.value }),
    }
  }

  static #toEthersTransaction(request: ICallRequest): {
    to: string
    from?: string
    data?: string
    value?: bigint
  } {
    return {
      to: request.to,
      ...(request.from === undefined ? {} : { from: request.from }),
      ...(request.data === undefined ? {} : { data: request.data }),
      ...(request.value === undefined ? {} : { value: request.value }),
    }
  }

  static #toLogEntry(log: {
    address: string
    topics: readonly string[]
    data: string
    blockNumber: number
    transactionHash: string
    index: number
    removed: boolean
  }): ILogEntry {
    return {
      address: toAddress(log.address),
      topics: log.topics.map((topic) => topic as HexString),
      data: log.data as HexString,
      blockNumber: BigInt(log.blockNumber),
      transactionHash: toTxHash(log.transactionHash),
      logIndex: log.index,
      removed: log.removed,
    }
  }
}

/** Приводит числовой идентификатор сети ethers к доменному типу. */
export function chainIdFromEthers(value: bigint): ChainId {
  return toChainId(value)
}
