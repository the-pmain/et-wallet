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
 * How long an address stays unfit after a failure.
 *
 * Without a cooldown, a failed address would be retried on every
 * connect, adding a timeout wait to every request. Five minutes is
 * long enough for a brief operator outage to end, and short enough
 * that the user does not notice the delay returning to the preferred
 * node.
 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000

/** Manager settings. */
export interface IRpcManagerOptions {
  readonly cooldownMs?: number
}

/** Manager dependencies. */
export interface IRpcManagerDependencies {
  /**
   * Address sources in preference order.
   *
   * Order is supplied from outside, not hardcoded here: it expresses
   * policy ("own node first, then managed, then public"), and policy
   * is configuration, not a property of the mechanism.
   */
  readonly providers: readonly IRpcProvider[]

  /** Transport. Connects to one specific address. */
  readonly factory: IProviderFactory

  readonly clock: IClock
  readonly logger: ILogger
  readonly options?: IRpcManagerOptions
}

/**
 * RPC-node selection, availability checks, and connection cache.
 *
 * WHAT HAPPENS HERE. The manager gathers addresses from every source
 * into one ordered list, drops those that failed recently, and hands
 * out a `FailoverProvider` that can survive a node failing mid-session.
 *
 * ONE CONNECTION PER NETWORK. The user switches networks back and
 * forth; closing the connection on every switch would re-verify
 * chainId on return. The cache stores a `Promise`, not a ready
 * provider: concurrent requests share one connect.
 *
 * SOURCE ORDER AND "DEFAULT". An address the user added comes before
 * the managed one: the user chose it on purpose, and ignoring that
 * choice for a default would undo the owner's decision. While there
 * is no own address, Alchemy is first — that is the "default".
 *
 * NODE AUTHENTICITY IS NOT SKIPPED. The transport verifies
 * `eth_chainId` on connect, and a node with a foreign id is dropped
 * the same way as an unreachable one.
 */
export class RpcManager implements IProviderResolver {
  readonly #providers: readonly IRpcProvider[]
  readonly #factory: IProviderFactory
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #cooldownMs: number

  readonly #connections = new Map<ChainId, Promise<FailoverProvider>>()

  /* Addresses that failed recently. Key is the URL, value is the
     moment until which it is not tried. */
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
   * Every network address from every source, in preference order.
   *
   * Duplicates are dropped: the same address may have been added
   * by the user and also appear in configuration.
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
   * Connection to a network, created on first use.
   *
   * @throws ProviderUnavailableError if no usable addresses remain or
   *         none of them answers.
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
      /* A failed attempt must not stay in cache: the next call would
         get the same rejected Promise and would not try to connect
         again even after the node recovered. */
      this.#connections.delete(network.chainId)

      throw error
    }
  }

  /**
   * Checks availability of every address on the network.
   *
   * The check performs a real connect and a block-number request:
   * there is no other way to measure what the user will feel.
   * Connections are closed immediately — this is diagnostics, not a
   * working channel.
   *
   * Addresses are checked in parallel: walking seven nodes with
   * timeouts sequentially would take tens of seconds.
   *
   * Failure of ONE address does not stop the rest: the point of the
   * operation is to show the state of all of them.
   */
  async checkHealth(network: INetworkConfig): Promise<readonly IRpcEndpointHealth[]> {
    const endpoints = this.listEndpoints(network)

    return await Promise.all(
      endpoints.map(async (endpoint) => await this.#checkEndpoint(endpoint, network)),
    )
  }

  /**
   * Adds a user address after verifying the node's authenticity.
   *
   * ORDER MATTERS. Connect and verify chainId first, persist only
   * after that. The reverse order would leave an address serving
   * another network in storage, and the wallet would apply it on
   * every launch — a ready replay attack: signatures made for a
   * foreign network are valid for replay.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError — address format.
   * @throws ChainIdMismatchError — the node serves another network.
   * @throws ProviderUnavailableError — the node does not answer.
   * @throws InvalidArgumentError — the custom-address source is not
   *         connected, or the address is already added.
   */
  async addCustomEndpoint(network: INetworkConfig, url: string): Promise<void> {
    assertValidRpcUrl(url)

    const custom = this.#requireCustomProvider()

    await this.#verifyEndpoint(url, network.chainId)
    await custom.add(network.chainId, url)

    /* The connection is rebuilt: the added address has priority, and
       staying on the previous node would ignore the user's choice
       until restart. */
    await this.release(network.chainId)

    this.#logger.info('Custom RPC endpoint added', {
      chainId: network.chainId,
    })
  }

  /** Removes a user address and rebuilds the connection. */
  async removeCustomEndpoint(network: INetworkConfig, url: string): Promise<void> {
    await this.#requireCustomProvider().remove(network.chainId, url)
    await this.release(network.chainId)
  }

  /** Closes the connection to one network. */
  async release(chainId: ChainId): Promise<void> {
    const pending = this.#connections.get(chainId)

    if (pending === undefined) {
      return
    }

    this.#connections.delete(chainId)

    await this.#destroyQuietly(pending)
  }

  /** Closes every connection. Called when the wallet locks. */
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

    /* Connect happens here, not on the first call: "network
       unavailable" must appear when the screen opens, not in the
       middle of preparing a transaction. */
    await provider.getBlockNumber()

    return provider
  }

  /**
   * Addresses that may be tried now.
   *
   * If no address has finished its cooldown, the full list is
   * returned: refusing to connect while unchecked addresses exist
   * is worse than spending time on an attempt.
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
    /* The transport receives a config with a single address:
       `FailoverProvider` owns rotation, and duplicating it inside
       the factory would mean two disagreeing rotation mechanisms. */
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
   * Confirms the node answers and serves the expected network.
   *
   * @throws ChainIdMismatchError, ProviderUnavailableError
   */
  async #verifyEndpoint(url: string, chainId: ChainId): Promise<void> {
    let provider: IProvider | null = null

    try {
      provider = await this.#factory.create(singleEndpointNetwork(chainId, url))
      await provider.getBlockNumber()
    } catch (error) {
      /* The factory walks addresses and reports the outcome as a
         single "no available nodes" error, hiding the real cause in
         `cause`. That is correct for rotation, but here the address
         is one and typed by the user: they need to know their node
         serves another network, not that "the network is
         unavailable". Otherwise they would hunt a connection problem
         that does not exist. */
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
        'the custom endpoint source is not connected to the manager',
      )
    }

    return custom
  }

  #markUnavailable(url: string): void {
    this.#unavailableUntil.set(url, (this.#clock.now() + this.#cooldownMs) as Timestamp)
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

/**
 * Finds a chainId mismatch in the cause chain.
 *
 * Transport reports a foreign network as a distinct error, but the
 * factory that walks addresses wraps it in "no available nodes" and
 * puts the original in `cause`. Nesting depth is not fixed, so the
 * whole chain is walked.
 *
 * A depth limit protects against a cycle on an error whose `cause`
 * points at itself: such objects come from external libraries.
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
 * Network config with a single address.
 *
 * Needed because transport accepts `INetworkConfig` while the caller
 * owns rotation. Fields that do not affect connect are filled with
 * stubs and never leave this function.
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
