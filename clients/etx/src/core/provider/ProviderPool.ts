import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'
import type { ChainId } from '@/core/types'

import type { IProvider, IProviderFactory, IProviderResolver } from './contracts'

const POOL_NAME = 'ProviderPool'

/** Зависимости пула. */
export interface IProviderPoolDependencies {
  readonly factory: IProviderFactory
  readonly logger: ILogger
}

/**
 * Переиспользование соединений с узлами.
 *
 * ЗАЧЕМ НУЖЕН. `IProviderFactory.create` — операция дорогая и сетевая:
 * она перебирает адреса из конфигурации и у каждого запрашивает `eth_chainId`
 * для сверки. Создавать провайдер на каждый запрос баланса значит выполнять
 * эту сверку по нескольку раз в минуту и упереться в лимиты публичного узла.
 *
 * ОДНО СОЕДИНЕНИЕ НА СЕТЬ, А НЕ ОДНО НА ВЕСЬ КОШЕЛЁК. Пользователь
 * переключает сети туда и обратно; закрывать соединение при каждом
 * переключении означало бы повторную сверку chainId при возврате.
 *
 * ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ РАЗДЕЛЯЮТ ОДНО СОЗДАНИЕ. В кэше лежит `Promise`,
 * а не готовый провайдер: экран, запросивший балансы трёх аккаунтов сразу,
 * иначе открыл бы три соединения к одному узлу.
 *
 * ВРЕМЯ ЖИЗНИ ПРИВЯЗАНО К СЕССИИ. `destroy()` обязателен при блокировке
 * кошелька: открытое соединение продолжает опрашивать узел и раскрывать
 * оператору факт активности пользователя.
 *
 * ОТНОШЕНИЕ К `RpcManager`. Пул — простой кэш: один адрес, одно соединение,
 * без выбора источника и без переключения при отказе узла посреди работы.
 * Приложение использует `RpcManager`, который это умеет. Пул сохранён как
 * минимальная реализация `IProviderResolver` для случаев, где перебор
 * не нужен, и как основа тестов, не зависящих от политики выбора узла.
 */
export class ProviderPool implements IProviderResolver {
  readonly #factory: IProviderFactory
  readonly #logger: ILogger
  readonly #providers = new Map<ChainId, Promise<IProvider>>()

  #destroyed = false

  constructor(dependencies: IProviderPoolDependencies) {
    this.#factory = dependencies.factory
    this.#logger = dependencies.logger.child(POOL_NAME)
  }

  /**
   * Возвращает соединение для сети, создавая его при первом обращении.
   *
   * @throws ProviderUnavailableError, ChainIdMismatchError
   */
  async get(network: INetworkConfig): Promise<IProvider> {
    if (this.#destroyed) {
      throw new Error('The connection pool is already closed')
    }

    const existing = this.#providers.get(network.chainId)

    if (existing !== undefined) {
      const provider = await existing

      /* Соединение могло быть разорвано транспортом. Мёртвый провайдер
         в кэше отвечал бы отказом на каждый запрос до конца сессии. */
      if (provider.isActive) {
        return provider
      }

      this.#providers.delete(network.chainId)
    }

    const created = this.#factory.create(network)

    this.#providers.set(network.chainId, created)

    try {
      return await created
    } catch (error) {
      /* Неудачную попытку нельзя оставлять в кэше: следующий вызов получил бы
         тот же отклонённый Promise и никогда не попробовал бы соединиться
         заново, даже когда узел восстановится. */
      this.#providers.delete(network.chainId)

      throw error
    }
  }

  /** Закрывает соединение с одной сетью. */
  async release(chainId: ChainId): Promise<void> {
    const pending = this.#providers.get(chainId)

    if (pending === undefined) {
      return
    }

    this.#providers.delete(chainId)

    await this.#destroyQuietly(pending)
  }

  /** Закрывает все соединения. Вызывается при блокировке кошелька. */
  async destroy(): Promise<void> {
    this.#destroyed = true

    const pending = [...this.#providers.values()]

    this.#providers.clear()

    await Promise.all(pending.map((provider) => this.#destroyQuietly(provider)))
  }

  /**
   * Закрывает соединение, не позволяя сбою прервать закрытие остальных.
   *
   * Блокировка кошелька обязана завершиться при любом состоянии транспорта:
   * исключение здесь оставило бы часть соединений открытыми.
   */
  async #destroyQuietly(pending: Promise<IProvider>): Promise<void> {
    try {
      ;(await pending).destroy()
    } catch (error) {
      this.#logger.warn('The connection closed with an error', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
