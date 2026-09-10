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
   * Third-party sources in preference order.
   *
   * Empty is the ordinary state: the wallet runs on one node, and
   * that is the default path.
   */
  readonly sources?: readonly ISimulationSource[]
}

/**
 * Chooses whom to ask about transaction consequences.
 *
 * THE NODE IS NOT ONE OF THE SOURCES, IT IS THE BASE. It is asked
 * last and always: a third-party service may be unconfigured, down,
 * unaware of the network, or refusing on rate — and none of those
 * cases must mean "cannot check". Hence the order: first whoever
 * knows more, then whoever is always there.
 *
 * SOURCE SILENCE IS PASSED ON, NOT ISSUED AS AN ANSWER. A source
 * that returned `null` is skipped; the `Unavailable` outcome
 * reaches the screen only if everyone stayed silent, including the
 * node.
 *
 * DOES NOT THROW. A check refusal must not abort transaction
 * preparation: the user would then see neither the consequences nor
 * the form.
 */
export class SimulationService {
  readonly #logger: ILogger
  readonly #sources: readonly ISimulationSource[]

  constructor(dependencies: ISimulationServiceDependencies) {
    this.#logger = dependencies.logger.child('SimulationService')
    this.#sources = dependencies.sources ?? []
  }

  /** Name of the source that will be asked first. `null` — node only. */
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
        /* A source that threw is equivalent to one that stayed
           silent: the next is asked, and at the end — the node. */
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
