import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'
import type { ChainId } from '@/core/types'

import type { IProvider, IProviderFactory, IProviderResolver } from './contracts'

const POOL_NAME = 'ProviderPool'

/** Pool dependencies. */
export interface IProviderPoolDependencies {
  readonly factory: IProviderFactory
  readonly logger: ILogger
}

/**
 * Reusing connections to nodes.
 *
 * WHY IT EXISTS. `IProviderFactory.create` is expensive and networked:
 * it walks addresses from config and asks each for `eth_chainId`.
 * Creating a provider on every balance request means doing that
 * verification several times a minute and hitting public-node limits.
 *
 * ONE CONNECTION PER NETWORK, NOT ONE FOR THE WHOLE WALLET. The user
 * switches networks back and forth; closing the connection on every
 * switch would re-verify chainId on return.
 *
 * CONCURRENT REQUESTS SHARE ONE CREATION. The cache stores a
 * `Promise`, not a ready provider: a screen that asked for three
 * account balances at once would otherwise open three connections
 * to one node.
 *
 * LIFETIME IS TIED TO THE SESSION. `destroy()` is required when the
 * wallet locks: an open connection keeps polling the node and
 * discloses user activity to the operator.
 *
 * RELATION TO `RpcManager`. The pool is a simple cache: one address,
 * one connection, no source selection and no switch when a node
 * fails mid-session. The app uses `RpcManager`, which can do that.
 * The pool is kept as a minimal `IProviderResolver` for cases where
 * rotation is not needed, and as a test base that does not depend
 * on node-selection policy.
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
   * Returns a connection for the network, creating it on first use.
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

      /* The connection may have been dropped by transport. A dead
         provider in cache would refuse every request until the
         session ended. */
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
      /* A failed attempt must not stay in cache: the next call would
         get the same rejected Promise and would never try to connect
         again, even after the node recovered. */
      this.#providers.delete(network.chainId)

      throw error
    }
  }

  /** Closes the connection to one network. */
  async release(chainId: ChainId): Promise<void> {
    const pending = this.#providers.get(chainId)

    if (pending === undefined) {
      return
    }

    this.#providers.delete(chainId)

    await this.#destroyQuietly(pending)
  }

  /** Closes every connection. Called when the wallet locks. */
  async destroy(): Promise<void> {
    this.#destroyed = true

    const pending = [...this.#providers.values()]

    this.#providers.clear()

    await Promise.all(pending.map((provider) => this.#destroyQuietly(provider)))
  }

  /**
   * Closes a connection without letting a failure interrupt the rest.
   *
   * Wallet lock must finish regardless of transport state: an
   * exception here would leave some connections open.
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
