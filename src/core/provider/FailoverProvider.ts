import { ProviderUnavailableError } from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { ILogger } from '@/core/platform'
import type { Address, BlockTag, ChainId, HexString, TxHash, Unsubscribe, Wei } from '@/core/types'

import type { IProvider } from './contracts'
import type { IRpcEndpoint } from './rpc-endpoint'
import type {
  ICallRequest,
  IFeeData,
  ILogEntry,
  ILogFilter,
  IRpcRequest,
  ITransactionReceipt,
  ProviderEventMap,
} from './types'

const PROVIDER_NAME = 'FailoverProvider'

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

  get isActive(): boolean {
    return !this.#destroyed
  }

  /** Действующий адрес с указанием источника. `null`, пока соединения нет. */
  get activeEndpoint(): IRpcEndpoint | null {
    return this.#current === null ? null : (this.#endpoints[this.#index] ?? null)
  }

  async request<TResult>(request: IRpcRequest): Promise<TResult> {
    return await this.#withFailover((provider) => provider.request<TResult>(request))
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

  async estimateGas(request: ICallRequest): Promise<bigint> {
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

  async getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    return await this.#withFailover((provider) => provider.getLogs(filter))
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
    this.#logger.warn('Узел исключён из перебора', {
      providerId: failed.providerId,
      hasReplacement: next !== null,
      reason,
    })

    this.#onSwitch?.(failed, next, reason)
  }
}
