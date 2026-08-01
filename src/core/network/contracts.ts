import type { IEventSource } from '@/core/events'
import type { ChainId } from '@/core/types'

import type { IAddNetworkParams, INetworkConfig, NetworkEventMap } from './types'

/**
 * Управление списком сетей и выбором активной.
 *
 * Сервис работает только с конфигурациями. Сетевые запросы выполняет
 * `IProvider`: смешение конфигурации и транспорта в одном объекте — типичная
 * ошибка, из-за которой конфигурацию сети становится невозможно сохранить
 * в хранилище (в ней оказываются сокеты и внутреннее состояние соединения).
 */
export interface INetworkService extends IEventSource<NetworkEventMap> {
  /**
   * Загружает сети и восстанавливает выбор активной.
   *
   * Встроенные сети берутся из кода и имеют приоритет над сохранёнными
   * копиями. Это защита от подмены: перезаписанный в хранилище RPC-адрес
   * основной сети был бы использован при каждом запуске.
   */
  init(): Promise<void>

  /**
   * Активная сеть.
   *
   * @throws NotInitializedError если `init()` ещё не вызван.
   */
  getActive(): INetworkConfig

  /** Все доступные сети: встроенные, затем добавленные пользователем. */
  list(): readonly INetworkConfig[]

  /** Поиск по идентификатору. `null`, если сеть не зарегистрирована. */
  getByChainId(chainId: ChainId): INetworkConfig | null

  /**
   * Переключает активную сеть.
   *
   * Переключение НЕ снимает и НЕ ставит блокировку кошелька: состояние
   * блокировки и выбор сети независимы.
   *
   * Повторное переключение на уже активную сеть не порождает события.
   *
   * @throws NetworkNotFoundError, NotInitializedError
   */
  switchTo(chainId: ChainId): Promise<void>

  /**
   * Добавляет пользовательскую сеть.
   *
   * До сохранения выполняются две проверки:
   * 1. Схема каждого RPC-адреса — только `https:` и `wss:`.
   * 2. Запрос `eth_chainId` у узла и сверка с заявленным значением.
   *
   * Второй пункт закрывает сценарий, в котором сайт предлагает добавить
   * «ту же сеть с более быстрым узлом», а узел на деле обслуживает другую
   * сеть и получает подписи, пригодные для повторного проигрывания.
   *
   * @throws NetworkAlreadyExistsError, InsecureRpcUrlError,
   *         InvalidRpcUrlError, ChainIdMismatchError, ProviderUnavailableError
   */
  add(params: IAddNetworkParams): Promise<INetworkConfig>

  /**
   * Удаляет пользовательскую сеть.
   *
   * Если удаляется активная сеть, активной становится сеть по умолчанию.
   *
   * @throws NetworkNotFoundError, BuiltInNetworkImmutableError
   */
  remove(chainId: ChainId): Promise<void>

  /**
   * Изменяет параметры пользовательской сети.
   *
   * Изменение `chainId` не поддерживается: это создание другой сети,
   * а не правка существующей.
   *
   * @throws NetworkNotFoundError, BuiltInNetworkImmutableError,
   *         InsecureRpcUrlError, InvalidRpcUrlError
   */
  update(chainId: ChainId, params: Partial<IAddNetworkParams>): Promise<INetworkConfig>
}

/**
 * Долговременное хранение конфигураций сетей.
 *
 * Репозиторий отделён от сервиса по принципу разделения обязанностей:
 * сервис содержит правила предметной области (что можно удалять, что надо
 * проверять), репозиторий — только доступ к данным. Это позволяет заменить
 * хранилище, не трогая правила, и тестировать правила без хранилища.
 */
export interface INetworkRepository {
  findAll(): Promise<readonly INetworkConfig[]>
  findByChainId(chainId: ChainId): Promise<INetworkConfig | null>
  save(config: INetworkConfig): Promise<void>
  delete(chainId: ChainId): Promise<void>

  /** Сохранённый выбор активной сети. */
  getActiveChainId(): Promise<ChainId | null>
  setActiveChainId(chainId: ChainId): Promise<void>
}
