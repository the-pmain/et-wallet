import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'
import type { ChainId } from '@/core/types'

import type { IProvider, IProviderFactory } from './contracts'
import { RpcClient, type IRpcClientOptions } from './RpcClient'

const FACTORY_NAME = 'RpcClientFactory'

/** Зависимости фабрики. */
export interface IRpcClientFactoryDependencies {
  readonly logger: ILogger
  readonly options?: IRpcClientOptions
}

/**
 * Создание соединений с перебором резервных узлов.
 *
 * ПОРЯДОК ПЕРЕБОРА. Адреса из `rpcUrls` пробуются по очереди, первый
 * откликнувшийся и прошедший сверку chainId становится действующим.
 * Список задаётся в порядке приоритета, поэтому перемешивать его нельзя:
 * первым обычно стоит наиболее надёжный оператор.
 *
 * ОТКАЗ ПРИ НЕСОВПАДЕНИИ chainId НЕ ПРОПУСКАЕТСЯ МОЛЧА. Узел, вернувший
 * чужой идентификатор сети, исключается из перебора, но факт записывается
 * в журнал предупреждением: это либо ошибка конфигурации, либо попытка
 * подмены, и оба случая заслуживают внимания.
 *
 * Если ни один адрес не подошёл, выбрасывается ошибка последней попытки:
 * при единственном узле с чужим chainId пользователь увидит именно эту
 * причину, а не обобщённое «сеть недоступна».
 */
export class RpcClientFactory implements IProviderFactory {
  readonly #logger: ILogger
  readonly #options: IRpcClientOptions

  constructor(dependencies: IRpcClientFactoryDependencies) {
    this.#logger = dependencies.logger.child(FACTORY_NAME)
    this.#options = dependencies.options ?? {}
  }

  async create(network: INetworkConfig): Promise<IProvider> {
    if (network.rpcUrls.length === 0) {
      throw new ProviderUnavailableError(network.chainId)
    }

    let lastError: unknown = null

    for (const rpcUrl of network.rpcUrls) {
      try {
        return await this.connect(rpcUrl, network.chainId)
      } catch (error) {
        lastError = error

        if (error instanceof ChainIdMismatchError) {
          this.#logger.warn(
            'The node serves a different network and was excluded from the rotation',
            {
              rpcUrl,
              expected: error.expected.toString(),
              actual: error.actual.toString(),
            },
          )
        } else {
          this.#logger.warn('The node is unavailable, switching to a backup', {
            rpcUrl,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    /* Ошибка последней попытки сохраняется как причина: при единственном
       узле с чужим chainId это важнее обобщённого «сеть недоступна». */
    throw new ProviderUnavailableError(network.chainId, { cause: lastError })
  }

  /**
   * Устанавливает соединение с одним узлом.
   *
   * Вынесен отдельным защищённым методом как точка подмены: тесты правил
   * перебора не должны зависеть от сети, а проверять их через реальные
   * запросы значило бы получить недетерминированный и медленный набор.
   *
   * Production-код метод не переопределяет.
   */
  protected async connect(rpcUrl: string, chainId: ChainId): Promise<IProvider> {
    return await RpcClient.connect(rpcUrl, chainId, this.#options)
  }
}
