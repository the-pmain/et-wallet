import { ChainIdMismatchError, InvalidArgumentError, ProviderUnavailableError } from '@/core/errors'
import { assertValidRpcUrl, type INetworkConfig } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { ChainId, Timestamp } from '@/core/types'

import type { IProvider, IProviderFactory, IProviderResolver } from './contracts'
import { CustomRpcProvider } from './CustomRpcProvider'
import { FailoverProvider } from './FailoverProvider'
import type { IRpcEndpoint, IRpcEndpointHealth, IRpcProvider } from './rpc-endpoint'

const MANAGER_NAME = 'RpcManager'

/**
 * Сколько адрес считается непригодным после отказа.
 *
 * Без выдержки отказавший адрес пробовался бы заново при каждом
 * подключении, добавляя к каждому запросу время ожидания таймаута.
 * Пять минут — достаточно, чтобы кратковременный сбой оператора успел
 * закончиться, и недостаточно, чтобы пользователь заметил задержку
 * возврата к предпочтительному узлу.
 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000

/** Настройки менеджера. */
export interface IRpcManagerOptions {
  readonly cooldownMs?: number
}

/** Зависимости менеджера. */
export interface IRpcManagerDependencies {
  /**
   * Источники адресов в порядке предпочтения.
   *
   * Порядок задаётся снаружи, а не зашит здесь: он выражает политику
   * («сначала собственный узел, потом управляемый, потом публичный»),
   * а политика — предмет настройки, а не свойство механизма.
   */
  readonly providers: readonly IRpcProvider[]

  /** Транспорт. Подключается к одному конкретному адресу. */
  readonly factory: IProviderFactory

  readonly clock: IClock
  readonly logger: ILogger
  readonly options?: IRpcManagerOptions
}

/**
 * Выбор RPC-узла, проверка доступности и кэш соединений.
 *
 * ЧТО ЗДЕСЬ ПРОИСХОДИТ. Менеджер собирает адреса со всех источников
 * в один упорядоченный список, отбрасывает те, что недавно отказали,
 * и отдаёт `FailoverProvider`, умеющий пережить отказ узла посреди сессии.
 *
 * ОДНО СОЕДИНЕНИЕ НА СЕТЬ. Пользователь переключает сети туда и обратно;
 * закрывать соединение при каждом переключении означало бы повторную
 * сверку chainId при возврате. В кэше лежит `Promise`, а не готовый
 * провайдер: параллельные запросы разделяют одно подключение.
 *
 * ПОРЯДОК ИСТОЧНИКОВ И «ПО УМОЛЧАНИЮ». Адрес, добавленный пользователем,
 * идёт впереди управляемого: пользователь выбрал его сознательно, и
 * игнорировать этот выбор ради значения по умолчанию значит отменять
 * решение владельца средств. Пока собственного адреса нет, первым
 * оказывается Alchemy — это и есть «по умолчанию».
 *
 * ПРОВЕРКА ПОДЛИННОСТИ УЗЛА НЕ ОТМЕНЕНА. Сверку `eth_chainId` выполняет
 * транспорт при подключении, и узел с чужим идентификатором исключается
 * так же, как недоступный.
 */
export class RpcManager implements IProviderResolver {
  readonly #providers: readonly IRpcProvider[]
  readonly #factory: IProviderFactory
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #cooldownMs: number

  readonly #connections = new Map<ChainId, Promise<FailoverProvider>>()

  /* Адреса, отказавшие недавно. Ключ — адрес, значение — момент,
     до которого он не пробуется. */
  readonly #unavailableUntil = new Map<string, Timestamp>()

  #destroyed = false

  constructor(dependencies: IRpcManagerDependencies) {
    this.#providers = dependencies.providers
    this.#factory = dependencies.factory
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(MANAGER_NAME)
    this.#cooldownMs = dependencies.options?.cooldownMs ?? DEFAULT_COOLDOWN_MS
  }

  /**
   * Все адреса сети со всех источников, в порядке предпочтения.
   *
   * Повторы отбрасываются: один и тот же адрес мог быть добавлен
   * пользователем вручную и одновременно присутствовать в конфигурации.
   */
  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    const seen = new Set<string>()
    const endpoints: IRpcEndpoint[] = []

    for (const provider of this.#providers) {
      if (!provider.supports(network.chainId)) {
        continue
      }

      for (const endpoint of provider.listEndpoints(network)) {
        if (seen.has(endpoint.url)) {
          continue
        }

        seen.add(endpoint.url)
        endpoints.push(endpoint)
      }
    }

    return endpoints
  }

  /**
   * Соединение с сетью, создаваемое при первом обращении.
   *
   * @throws ProviderUnavailableError если пригодных адресов нет либо
   *         ни один не отвечает.
   */
  async get(network: INetworkConfig): Promise<IProvider> {
    if (this.#destroyed) {
      throw new ProviderUnavailableError(network.chainId)
    }

    const existing = this.#connections.get(network.chainId)

    if (existing !== undefined) {
      const provider = await existing

      if (provider.isActive) {
        return provider
      }

      this.#connections.delete(network.chainId)
    }

    const created = this.#createFailover(network)

    this.#connections.set(network.chainId, created)

    try {
      return await created
    } catch (error) {
      /* Неудачную попытку нельзя оставлять в кэше: следующий вызов получил
         бы тот же отклонённый Promise и не попробовал бы соединиться заново
         даже после восстановления узла. */
      this.#connections.delete(network.chainId)

      throw error
    }
  }

  /**
   * Проверяет доступность всех адресов сети.
   *
   * Проверка выполняет настоящее подключение и запрос номера блока:
   * измерить то, что почувствует пользователь, иначе невозможно.
   * Соединения закрываются сразу — это диагностика, а не рабочий канал.
   *
   * Адреса проверяются параллельно: последовательный обход семи узлов
   * с таймаутами занял бы десятки секунд.
   *
   * Отказ ОДНОГО адреса не прерывает проверку остальных: смысл операции
   * в том, чтобы показать состояние всех.
   */
  async checkHealth(network: INetworkConfig): Promise<readonly IRpcEndpointHealth[]> {
    const endpoints = this.listEndpoints(network)

    return await Promise.all(
      endpoints.map(async (endpoint) => await this.#checkEndpoint(endpoint, network)),
    )
  }

  /**
   * Добавляет пользовательский адрес после проверки подлинности узла.
   *
   * ПОРЯДОК ДЕЙСТВИЙ ЗНАЧИМ. Сначала подключение и сверка chainId, только
   * потом сохранение. Обратный порядок оставил бы в хранилище адрес узла,
   * обслуживающего другую сеть, и кошелёк применял бы его при каждом
   * запуске — готовый приём подмены: подписи, сделанные для чужой сети,
   * пригодны для повторного проигрывания.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError — формат адреса.
   * @throws ChainIdMismatchError — узел обслуживает другую сеть.
   * @throws ProviderUnavailableError — узел не отвечает.
   * @throws InvalidArgumentError — источник пользовательских адресов
   *         не подключён либо адрес уже добавлен.
   */
  async addCustomEndpoint(network: INetworkConfig, url: string): Promise<void> {
    assertValidRpcUrl(url)

    const custom = this.#requireCustomProvider()

    await this.#verifyEndpoint(url, network.chainId)
    await custom.add(network.chainId, url)

    /* Соединение пересоздаётся: добавленный адрес имеет приоритет,
       и продолжать работу через прежний узел значило бы не применить
       выбор пользователя до перезапуска. */
    await this.release(network.chainId)

    this.#logger.info('Добавлен пользовательский RPC-адрес', {
      chainId: network.chainId,
    })
  }

  /** Удаляет пользовательский адрес и пересоздаёт соединение. */
  async removeCustomEndpoint(network: INetworkConfig, url: string): Promise<void> {
    await this.#requireCustomProvider().remove(network.chainId, url)
    await this.release(network.chainId)
  }

  /** Закрывает соединение с одной сетью. */
  async release(chainId: ChainId): Promise<void> {
    const pending = this.#connections.get(chainId)

    if (pending === undefined) {
      return
    }

    this.#connections.delete(chainId)

    await this.#destroyQuietly(pending)
  }

  /** Закрывает все соединения. Вызывается при блокировке кошелька. */
  async destroy(): Promise<void> {
    this.#destroyed = true

    const pending = [...this.#connections.values()]

    this.#connections.clear()
    this.#unavailableUntil.clear()

    await Promise.all(pending.map(async (provider) => await this.#destroyQuietly(provider)))
  }

  async #createFailover(network: INetworkConfig): Promise<FailoverProvider> {
    const endpoints = this.#availableEndpoints(network)

    if (endpoints.length === 0) {
      throw new ProviderUnavailableError(network.chainId)
    }

    const provider = new FailoverProvider({
      chainId: network.chainId,
      endpoints,
      logger: this.#logger,
      connect: async (endpoint, chainId) => await this.#connect(endpoint, chainId),
      onSwitch: (failed) => {
        this.#markUnavailable(failed.url)
      },
    })

    /* Подключение выполняется здесь, а не при первом вызове: ошибка
       «сеть недоступна» должна возникнуть при открытии экрана, а не
       посреди подготовки транзакции. */
    await provider.getBlockNumber()

    return provider
  }

  /**
   * Адреса, пригодные к попытке сейчас.
   *
   * Если выдержку не отбыл ни один адрес, возвращается полный список:
   * отказать в подключении, имея непроверенные адреса, хуже, чем
   * потратить время на попытку.
   */
  #availableEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    const all = this.listEndpoints(network)
    const now = this.#clock.now()
    const available = all.filter((endpoint) => {
      const until = this.#unavailableUntil.get(endpoint.url)

      return until === undefined || until <= now
    })

    return available.length > 0 ? available : all
  }

  async #connect(endpoint: IRpcEndpoint, chainId: ChainId): Promise<IProvider> {
    /* Транспорту передаётся конфигурация с единственным адресом: перебор
       выполняет `FailoverProvider`, и дублировать его внутри фабрики
       значило бы иметь два несогласованных механизма перебора. */
    return await this.#factory.create(singleEndpointNetwork(chainId, endpoint.url))
  }

  async #checkEndpoint(
    endpoint: IRpcEndpoint,
    network: INetworkConfig,
  ): Promise<IRpcEndpointHealth> {
    const startedAt = this.#clock.now()
    let provider: IProvider | null = null

    try {
      provider = await this.#connect(endpoint, network.chainId)
      await provider.getBlockNumber()

      return {
        endpoint,
        isHealthy: true,
        latencyMs: this.#clock.now() - startedAt,
        reason: null,
        isChainMismatch: false,
      }
    } catch (error) {
      this.#markUnavailable(endpoint.url)

      const mismatch = findChainIdMismatch(error)

      return {
        endpoint,
        isHealthy: false,
        latencyMs: null,
        reason: (mismatch ?? (error instanceof Error ? error : new Error(String(error)))).message,
        isChainMismatch: mismatch !== null,
      }
    } finally {
      provider?.destroy()
    }
  }

  /**
   * Убеждается, что узел отвечает и обслуживает ожидаемую сеть.
   *
   * @throws ChainIdMismatchError, ProviderUnavailableError
   */
  async #verifyEndpoint(url: string, chainId: ChainId): Promise<void> {
    let provider: IProvider | null = null

    try {
      provider = await this.#factory.create(singleEndpointNetwork(chainId, url))
      await provider.getBlockNumber()
    } catch (error) {
      /* Фабрика перебирает адреса и сообщает итог одной ошибкой
         «нет доступных узлов», спрятав настоящую причину в `cause`.
         Для перебора это верно, но здесь адрес один и указан вручную:
         пользователю нужно знать, что его узел обслуживает другую сеть,
         а не что «сеть недоступна». Иначе он будет искать несуществующую
         проблему с соединением. */
      throw findChainIdMismatch(error) ?? error
    } finally {
      provider?.destroy()
    }
  }

  #requireCustomProvider(): CustomRpcProvider {
    const custom = this.#providers.find(
      (provider): provider is CustomRpcProvider => provider instanceof CustomRpcProvider,
    )

    if (custom === undefined) {
      throw new InvalidArgumentError(
        'providers',
        'источник пользовательских адресов не подключён к менеджеру',
      )
    }

    return custom
  }

  #markUnavailable(url: string): void {
    this.#unavailableUntil.set(url, (this.#clock.now() + this.#cooldownMs) as Timestamp)
  }

  /**
   * Закрывает соединение, не позволяя сбою прервать закрытие остальных.
   *
   * Блокировка кошелька обязана завершиться при любом состоянии
   * транспорта: исключение здесь оставило бы часть соединений открытыми.
   */
  async #destroyQuietly(pending: Promise<IProvider>): Promise<void> {
    try {
      ;(await pending).destroy()
    } catch (error) {
      this.#logger.warn('Соединение закрыто с ошибкой', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Ищет несовпадение chainId в цепочке причин.
 *
 * Транспорт сообщает о чужой сети отдельной ошибкой, но фабрика,
 * перебирающая адреса, заворачивает её в «нет доступных узлов»
 * и кладёт исходную в `cause`. Глубина вложенности не фиксирована,
 * поэтому цепочка обходится целиком.
 *
 * Ограничение глубины защищает от зацикливания на ошибке, чья `cause`
 * ссылается на неё саму: такие объекты приходят из внешних библиотек.
 */
function findChainIdMismatch(error: unknown): ChainIdMismatchError | null {
  const MAX_DEPTH = 8
  let current: unknown = error

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current instanceof ChainIdMismatchError) {
      return current
    }

    if (!(current instanceof Error)) {
      return null
    }

    current = current.cause
  }

  return null
}

/**
 * Конфигурация сети с единственным адресом.
 *
 * Нужна потому, что транспорт принимает `INetworkConfig`, а перебором
 * занимается вызывающий код. Поля, не влияющие на подключение, заполнены
 * значениями-заглушками и наружу не выходят.
 */
function singleEndpointNetwork(chainId: ChainId, url: string): INetworkConfig {
  return {
    chainId,
    name: '',
    nativeCurrency: { name: '', symbol: '', decimals: 18 },
    rpcUrls: [url],
    blockExplorerUrls: [],
    isTestnet: false,
    isBuiltIn: false,
    supportsEip1559: true,
  }
}
