import type { IEventSource } from '@/core/events'
import type { ChainId } from '@/core/types'

import type { IAddNetworkParams, INetworkConfig, NetworkEventMap } from './types'

/**
 * Manages the network list and the active selection.
 *
 * The service works with configurations only. Network requests are
 * made by `IProvider`: mixing configuration and transport in one
 * object is a typical mistake that makes a network config
 * impossible to persist (sockets and connection state end up in it).
 */
export interface INetworkService extends IEventSource<NetworkEventMap> {
  /**
   * Loads networks and restores the active selection.
   *
   * Built-in networks come from code and take priority over saved
   * copies. That is the defence against substitution: an RPC
   * address of the main network overwritten in storage would be
   * used on every launch.
   */
  init(): Promise<void>

  /**
   * Active network.
   *
   * @throws NotInitializedError if `init()` has not been called yet.
   */
  getActive(): INetworkConfig

  /** All available networks: built-in first, then user-added. */
  list(): readonly INetworkConfig[]

  /** Lookup by id. `null` if the network is not registered. */
  getByChainId(chainId: ChainId): INetworkConfig | null

  /**
   * Switches the active network.
   *
   * Switching does NOT lock or unlock the wallet: lock state and
   * network selection are independent.
   *
   * Switching again to the already-active network does not emit.
   *
   * @throws NetworkNotFoundError, NotInitializedError
   */
  switchTo(chainId: ChainId): Promise<void>

  /**
   * Adds a user network.
   *
   * Two checks run before save:
   * 1. Each RPC address scheme is only `https:` or `wss:`.
   * 2. An `eth_chainId` request to the node, checked against the claimed value.
   *
   * The second closes the scenario where a site offers to add
   * "the same network with a faster node", while the node in fact
   * serves another network and collects signatures fit for replay.
   *
   * @throws NetworkAlreadyExistsError, InsecureRpcUrlError,
   *         InvalidRpcUrlError, ChainIdMismatchError, ProviderUnavailableError
   */
  add(params: IAddNetworkParams): Promise<INetworkConfig>

  /**
   * Removes a user network.
   *
   * If the active network is removed, the default network becomes active.
   *
   * @throws NetworkNotFoundError, BuiltInNetworkImmutableError
   */
  remove(chainId: ChainId): Promise<void>

  /**
   * Changes parameters of a user network.
   *
   * Changing `chainId` is not supported: that is creating another
   * network, not editing the existing one.
   *
   * @throws NetworkNotFoundError, BuiltInNetworkImmutableError,
   *         InsecureRpcUrlError, InvalidRpcUrlError
   */
  update(chainId: ChainId, params: Partial<IAddNetworkParams>): Promise<INetworkConfig>
}

/**
 * Long-term storage of network configurations.
 *
 * The repository is split from the service by responsibility:
 * the service holds domain rules (what may be deleted, what must
 * be checked), the repository — data access only. That lets the
 * store be replaced without touching the rules, and the rules
 * tested without a store.
 */
export interface INetworkRepository {
  findAll(): Promise<readonly INetworkConfig[]>
  findByChainId(chainId: ChainId): Promise<INetworkConfig | null>
  save(config: INetworkConfig): Promise<void>
  delete(chainId: ChainId): Promise<void>

  getActiveChainId(): Promise<ChainId | null>
  setActiveChainId(chainId: ChainId): Promise<void>
}
