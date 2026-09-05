import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'

import type { IProvider, IProviderFactory } from './contracts'

/** Factory dependencies. Same as the real factory. */
export interface ILazyRpcClientFactoryDependencies {
  readonly logger: ILogger
}

/**
 * Connection factory that loads transport on first use.
 *
 * WHY. `RpcClient` sits on ethers, and ethers is the heaviest app
 * dependency: about 250 KB before compression. The real factory is
 * created in the wallet-session constructor, i.e. at startup — and
 * pulled ethers into the initial chunk on screens that have no
 * network at all: welcome, wallet creation, unlock.
 *
 * Here transport is loaded only when a node connection is actually
 * needed — i.e. after unlock.
 *
 * WHY THIS DOES NOT SLOW THINGS DOWN. `create` is already async: it
 * connects to a node and verifies chainId. Chunk load is added to
 * that wait once per session, and after the first call the module
 * stays in memory — the import promise is remembered.
 *
 * WHAT THIS DOES NOT CHANGE. Neither behaviour nor checks: the same
 * `RpcClient` is returned, including chainId verification and backup
 * rotation. The only difference is when the code is loaded.
 */
export class LazyRpcClientFactory implements IProviderFactory {
  readonly #logger: ILogger

  /* The promise is remembered, not the result: two concurrent calls
     would otherwise start two loads of the same module. */
  #loading: Promise<IProviderFactory> | null = null

  constructor(dependencies: ILazyRpcClientFactoryDependencies) {
    this.#logger = dependencies.logger
  }

  async create(network: INetworkConfig): Promise<IProvider> {
    this.#loading ??= this.#load()

    return await (await this.#loading).create(network)
  }

  async #load(): Promise<IProviderFactory> {
    const { RpcClientFactory } = await import('./RpcClientFactory')

    return new RpcClientFactory({ logger: this.#logger })
  }
}
