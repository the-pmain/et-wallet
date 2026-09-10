import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'
import type { ChainId } from '@/core/types'

import type { IProvider, IProviderFactory } from './contracts'
import { RpcClient, type IRpcClientOptions } from './RpcClient'

const FACTORY_NAME = 'RpcClientFactory'

/** Factory dependencies. */
export interface IRpcClientFactoryDependencies {
  readonly logger: ILogger
  readonly options?: IRpcClientOptions
}

/**
 * Creating connections with backup-node rotation.
 *
 * ROTATION ORDER. Addresses from `rpcUrls` are tried in order; the
 * first that answers and passes chainId verification becomes active.
 * The list is in priority order, so it must not be shuffled: the
 * most reliable operator is usually first.
 *
 * A chainId MISMATCH IS NOT SKIPPED IN SILENCE. A node that returned
 * a foreign network id is dropped from rotation, but the fact is
 * logged as a warning: it is either a config error or an
 * impersonation attempt, and both deserve attention.
 *
 * If no address fits, the last attempt's error is thrown: with a
 * single node on a foreign chainId the user will see that reason,
 * not a generic "network unavailable".
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

    /* The last attempt's error is kept as the cause: with a single
       node on a foreign chainId that matters more than a generic
       "network unavailable". */
    throw new ProviderUnavailableError(network.chainId, { cause: lastError })
  }

  /**
   * Establishes a connection to one node.
   *
   * Extracted as a protected method so tests can substitute it:
   * rotation-rule tests must not depend on the network, and checking
   * them through real requests would make a non-deterministic, slow
   * suite.
   *
   * Production code does not override this method.
   */
  protected async connect(rpcUrl: string, chainId: ChainId): Promise<IProvider> {
    return await RpcClient.connect(rpcUrl, chainId, this.#options)
  }
}
