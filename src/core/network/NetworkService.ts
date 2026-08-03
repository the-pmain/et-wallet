import {
  BuiltInNetworkImmutableError,
  ChainIdMismatchError,
  NetworkAlreadyExistsError,
  NetworkImpersonationError,
  NetworkNotFoundError,
  NotInitializedError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { ILogger } from '@/core/platform'
import type { IProviderFactory } from '@/core/provider'
import { parseChainIdFromHex, type ChainId, type Unsubscribe } from '@/core/types'

import type { INetworkRepository, INetworkService } from './contracts'
import { findImpersonation } from './impersonation'
import { assertValidExplorerUrl, assertValidRpcUrls } from './rpc-url'
import type { IAddNetworkParams, INetworkConfig, NetworkEventMap } from './types'

/** Зависимости сервиса. Внедряются конструктором. */
export interface INetworkServiceDependencies {
  readonly repository: INetworkRepository

  /**
   * Нужна только для проверки подлинности узла при добавлении сети.
   * Постоянного соединения сервис не держит — это обязанность `IWalletManager`.
   */
  readonly providerFactory: IProviderFactory

  readonly logger: ILogger

  /** Перечень встроенных сетей. Передаётся извне ради сменности набора. */
  readonly builtInNetworks: readonly INetworkConfig[]

  /** Сеть, активная при первом запуске и при удалении активной сети. */
  readonly defaultChainId: ChainId
}

const SERVICE_NAME = 'NetworkService'

/**
 * Реализация управления сетями.
 *
 * Состояние держится в памяти: список сетей нужен интерфейсу постоянно,
 * а обращение к хранилищу на каждый рендер списка недопустимо. Хранилище
 * читается один раз при `init()` и пишется при изменениях.
 */
export class NetworkService implements INetworkService {
  readonly #repository: INetworkRepository
  readonly #providerFactory: IProviderFactory
  readonly #logger: ILogger
  readonly #builtInNetworks: readonly INetworkConfig[]
  readonly #defaultChainId: ChainId

  /* Сбой подписчика уходит в журнал, а не в глобальный обработчик
     необработанных исключений: неисправный компонент интерфейса не должен
     выглядеть как отказ ядра. */
  readonly #events = new EventBus<NetworkEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Network event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  readonly #networks = new Map<ChainId, INetworkConfig>()

  #activeChainId: ChainId | null = null
  #initialized = false

  constructor(dependencies: INetworkServiceDependencies) {
    this.#repository = dependencies.repository
    this.#providerFactory = dependencies.providerFactory
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#builtInNetworks = dependencies.builtInNetworks
    this.#defaultChainId = dependencies.defaultChainId
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return
    }

    /* Порядок заполнения принципиален.

       Сначала встроенные сети — они формируют базовый набор. Затем
       пользовательские из хранилища, причём записи с chainId встроенной
       сети отбрасываются.

       Это защита от подмены. Если вредоносный код или ошибка перезапишет
       в хранилище RPC-адрес Ethereum на подконтрольный узел, кошелёк ходил
       бы туда при каждом запуске. Пересев встроенных сетей из кода
       закрывает такой сценарий: сохранённая копия попросту игнорируется. */
    for (const network of this.#builtInNetworks) {
      this.#networks.set(network.chainId, network)
    }

    const stored = await this.#repository.findAll()

    for (const network of stored) {
      if (this.#isBuiltIn(network.chainId)) {
        this.#logger.warn('The stored copy of a built-in network was ignored', {
          chainId: network.chainId.toString(),
        })
        continue
      }

      this.#networks.set(network.chainId, network)
    }

    const storedActive = await this.#repository.getActiveChainId()

    /* Сохранённый выбор мог указывать на удалённую пользовательскую сеть. */
    this.#activeChainId =
      storedActive !== null && this.#networks.has(storedActive)
        ? storedActive
        : this.#defaultChainId

    this.#initialized = true

    this.#logger.info('Networks loaded', {
      total: this.#networks.size,
      activeChainId: this.#activeChainId.toString(),
    })
  }

  getActive(): INetworkConfig {
    this.#assertInitialized()

    const active = this.#networks.get(this.#activeChainId as ChainId)

    if (active === undefined) {
      /* Недостижимо при корректном init(): активный идентификатор всегда
         выбирается из числа загруженных. Проверка оставлена как страховка
         от рассогласования состояния при будущих правках. */
      throw new NetworkNotFoundError(this.#activeChainId as ChainId)
    }

    return active
  }

  list(): readonly INetworkConfig[] {
    return [...this.#networks.values()]
  }

  getByChainId(chainId: ChainId): INetworkConfig | null {
    return this.#networks.get(chainId) ?? null
  }

  async switchTo(chainId: ChainId): Promise<void> {
    this.#assertInitialized()

    if (!this.#networks.has(chainId)) {
      throw new NetworkNotFoundError(chainId)
    }

    /* Повторное переключение на активную сеть не должно порождать событие:
       подписчики пересоздают провайдер и сбрасывают кэши по этому сигналу. */
    if (this.#activeChainId === chainId) {
      return
    }

    await this.#repository.setActiveChainId(chainId)
    this.#activeChainId = chainId

    this.#logger.info('Active network changed', { chainId: chainId.toString() })
    this.#events.emit('network:changed', { chainId })
  }

  async add(params: IAddNetworkParams): Promise<INetworkConfig> {
    this.#assertInitialized()

    if (this.#networks.has(params.chainId)) {
      throw new NetworkAlreadyExistsError(params.chainId)
    }

    assertValidRpcUrls(params.rpcUrls)

    for (const url of params.blockExplorerUrls ?? []) {
      assertValidExplorerUrl(url)
    }

    /*
      Проверка на подмену выполняется ДО обращения к узлу.

      Порядок важен: сверка chainId требует сетевого запроса и занимает
      секунды, а совпадение имени видно сразу. Но главное — сверка
      chainId эту подмену не поймает в принципе: узел честно подтвердит
      свой идентификатор, и проверка пройдёт.
    */
    const impersonation = findImpersonation(params, this.#builtInNetworks)

    if (impersonation !== null && params.allowImpersonation !== true) {
      throw new NetworkImpersonationError(
        impersonation.name,
        impersonation.impersonated.chainId,
        params.chainId,
      )
    }

    const candidate: INetworkConfig = {
      chainId: params.chainId,
      name: params.name,
      nativeCurrency: params.nativeCurrency,
      rpcUrls: params.rpcUrls,
      blockExplorerUrls: params.blockExplorerUrls ?? [],
      isTestnet: params.isTestnet ?? false,
      isBuiltIn: false,
      /* Поддержка EIP-1559 определяется по ответу узла на этапе транзакций.
         До этого момента консервативное предположение безопаснее: завышенная
         оценка комиссии приведёт к переплате, заниженная — к зависшей
         транзакции, которую придётся вытеснять. */
      supportsEip1559: false,
    }

    await this.#verifyChainId(candidate)

    await this.#repository.save(candidate)
    this.#networks.set(candidate.chainId, candidate)

    this.#logger.info('Custom network added', {
      chainId: candidate.chainId.toString(),
    })
    this.#emitListChanged()

    return candidate
  }

  async remove(chainId: ChainId): Promise<void> {
    this.#assertInitialized()

    const existing = this.#networks.get(chainId)

    if (existing === undefined) {
      throw new NetworkNotFoundError(chainId)
    }

    if (existing.isBuiltIn) {
      throw new BuiltInNetworkImmutableError(chainId)
    }

    await this.#repository.delete(chainId)
    this.#networks.delete(chainId)

    this.#logger.info('Custom network removed', { chainId: chainId.toString() })
    this.#emitListChanged()

    /* Удаление активной сети обязано оставить приложение в рабочем
       состоянии, а не в положении «активной сети нет». */
    if (this.#activeChainId === chainId) {
      await this.switchTo(this.#defaultChainId)
    }
  }

  async update(chainId: ChainId, params: Partial<IAddNetworkParams>): Promise<INetworkConfig> {
    this.#assertInitialized()

    const existing = this.#networks.get(chainId)

    if (existing === undefined) {
      throw new NetworkNotFoundError(chainId)
    }

    if (existing.isBuiltIn) {
      throw new BuiltInNetworkImmutableError(chainId)
    }

    if (params.rpcUrls !== undefined) {
      assertValidRpcUrls(params.rpcUrls)
    }

    for (const url of params.blockExplorerUrls ?? []) {
      assertValidExplorerUrl(url)
    }

    /* chainId не берётся из params сознательно: смена идентификатора —
       это другая сеть, а не правка существующей. Молчаливое переназначение
       оставило бы в хранилище запись под старым ключом. */
    const updated: INetworkConfig = {
      ...existing,
      name: params.name ?? existing.name,
      nativeCurrency: params.nativeCurrency ?? existing.nativeCurrency,
      rpcUrls: params.rpcUrls ?? existing.rpcUrls,
      blockExplorerUrls: params.blockExplorerUrls ?? existing.blockExplorerUrls,
      isTestnet: params.isTestnet ?? existing.isTestnet,
    }

    await this.#repository.save(updated)
    this.#networks.set(chainId, updated)

    this.#emitListChanged()

    return updated
  }

  on<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Сверяет заявленный chainId с ответом узла.
   *
   * Самая важная проверка модуля. Без неё сайт может предложить добавить
   * «ту же сеть с более быстрым узлом», а узел на деле обслуживает другую
   * сеть. Пользователь подписывает транзакцию, считая её принадлежащей
   * одной сети, а подпись оказывается пригодной для проигрывания в другой.
   *
   * Соединение закрывается в любом случае: сервис не держит провайдеров.
   */
  async #verifyChainId(candidate: INetworkConfig): Promise<void> {
    const provider = await this.#providerFactory.create(candidate)

    try {
      const response = await provider.request<unknown>({ method: 'eth_chainId' })
      const actual = parseChainIdFromHex(response)

      if (actual !== candidate.chainId) {
        this.#logger.warn('The node reported a foreign chainId', {
          expected: candidate.chainId.toString(),
          actual: actual.toString(),
        })

        throw new ChainIdMismatchError(candidate.chainId, actual)
      }
    } finally {
      provider.destroy()
    }
  }

  #isBuiltIn(chainId: ChainId): boolean {
    return this.#builtInNetworks.some((network) => network.chainId === chainId)
  }

  #emitListChanged(): void {
    this.#events.emit('network:listChanged', {
      chainIds: [...this.#networks.keys()],
    })
  }

  #assertInitialized(): void {
    if (!this.#initialized || this.#activeChainId === null) {
      throw new NotInitializedError(SERVICE_NAME)
    }
  }
}
