import type { ILogger } from '@/core/platform'
import type { IProvider } from '@/core/provider'
import {
  UNCHECKED_SIMULATION,
  simulateTransaction,
  type ISimulationRequest,
  type ISimulationResult,
} from '@/core/transaction'
import type { ChainId } from '@/core/types'

import type { ISimulationSource } from './contracts'

export interface ISimulationServiceDependencies {
  readonly logger: ILogger

  /**
   * Сторонние источники в порядке предпочтения.
   *
   * Пусто — обычное положение дел: кошелёк работает на одном узле,
   * и это путь по умолчанию.
   */
  readonly sources?: readonly ISimulationSource[]
}

/**
 * Выбирает, у кого спросить о следствиях транзакции.
 *
 * УЗЕЛ — НЕ ОДИН ИЗ ИСТОЧНИКОВ, А ОСНОВАНИЕ. Он опрашивается последним
 * и всегда: сторонний сервис может быть не настроен, не работать,
 * не знать сети или отвечать отказом по частоте — и ни один из этих
 * случаев не должен означать «проверить нельзя». Отсюда порядок:
 * сначала тот, кто знает больше, затем тот, кто есть всегда.
 *
 * МОЛЧАНИЕ ИСТОЧНИКА ПЕРЕДАЁТСЯ ДАЛЬШЕ, А НЕ ВЫДАЁТСЯ ЗА ОТВЕТ.
 * Источник, вернувший `null`, пропускается; исход `Unavailable`
 * доходит до экрана, только если промолчали все, включая узел.
 *
 * ИСКЛЮЧЕНИЙ НЕ БРОСАЕТ. Отказ проверки не может срывать подготовку
 * транзакции: пользователь тогда не увидел бы ни следствий, ни формы.
 */
export class SimulationService {
  readonly #logger: ILogger
  readonly #sources: readonly ISimulationSource[]

  constructor(dependencies: ISimulationServiceDependencies) {
    this.#logger = dependencies.logger.child('SimulationService')
    this.#sources = dependencies.sources ?? []
  }

  /** Имя источника, который будет спрошен первым. `null` — только узел. */
  activeSourceName(): string | null {
    return this.#sources.find((source) => source.isAvailable())?.name ?? null
  }

  async simulate(
    provider: IProvider,
    request: ISimulationRequest,
    chainId: ChainId,
  ): Promise<ISimulationResult> {
    for (const source of this.#sources) {
      if (!source.isAvailable()) {
        continue
      }

      try {
        const result = await source.simulate(request, chainId)

        if (result !== null) {
          return result
        }
      } catch (error) {
        /* Источник, бросивший исключение, равносилен промолчавшему:
           дальше спрашивается следующий, и в конце — узел. */
        this.#logger.warn('A simulation source failed', {
          source: source.id,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      return await simulateTransaction(provider, request)
    } catch (error) {
      this.#logger.warn('The node could not simulate the transaction', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return UNCHECKED_SIMULATION
    }
  }
}
