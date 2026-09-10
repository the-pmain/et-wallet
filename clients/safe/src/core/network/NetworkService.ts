import {
  BuiltInNetworkImmutableError,
  ChainIdMismatchError,
  NetworkAlreadyExistsError,
  NetworkImpersonationError,
  NetworkNotFoundError,
  NotInitializedError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { ILogger } from '@/core/platform'
import type { IProviderFactory } from '@/core/provider'
import { parseChainIdFromHex, type ChainId, type Unsubscribe } from '@/core/types'

import type { INetworkRepository, INetworkService } from './contracts'
import { findImpersonation } from './impersonation'
import { assertValidExplorerUrl, assertValidRpcUrls } from './rpc-url'
import type { IAddNetworkParams, INetworkConfig, NetworkEventMap } from './types'

export interface INetworkServiceDependencies {
  readonly repository: INetworkRepository

  /**
   * Needed only to check the node is genuine when adding a network.
   * The service does not hold a standing connection — that is
   * `IWalletManager`'s job.
   */
  readonly providerFactory: IProviderFactory

  readonly logger: ILogger

  /** Built-in networks. Passed in so the set can be swapped. */
  readonly builtInNetworks: readonly INetworkConfig[]

  /** Network active on first launch and when the active network is removed. */
  readonly defaultChainId: ChainId
}

const SERVICE_NAME = 'NetworkService'

/**
 * Network management.
 *
 * State is held in memory: the UI needs the network list constantly,
 * and hitting storage on every list render is not acceptable.
 * Storage is read once at `init()` and written on changes.
 */
export class NetworkService implements INetworkService {
  readonly #repository: INetworkRepository
  readonly #providerFactory: IProviderFactory
  readonly #logger: ILogger
  readonly #builtInNetworks: readonly INetworkConfig[]
  readonly #defaultChainId: ChainId

  /* A listener failure goes to the log, not to the global unhandled-
     rejection handler: a broken UI component must not look like a
     core failure. */
  readonly #events = new EventBus<NetworkEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Network event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  readonly #networks = new Map<ChainId, INetworkConfig>()

  #activeChainId: ChainId | null = null
  #initialized = false

  constructor(dependencies: INetworkServiceDependencies) {
    this.#repository = dependencies.repository
    this.#providerFactory = dependencies.providerFactory
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#builtInNetworks = dependencies.builtInNetworks
    this.#defaultChainId = dependencies.defaultChainId
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return
    }

    /* Fill order is essential.

       Built-in networks first — they form the base set. Then user
       networks from storage, and records whose chainId matches a
       built-in network are dropped.

       That is the defence against substitution. If malware or a bug
       overwrites Ethereum's RPC address in storage with a node they
       control, the wallet would talk to it on every launch.
       Re-seeding built-in networks from code closes that scenario:
       the stored copy is simply ignored. */
    for (const network of this.#builtInNetworks) {
      this.#networks.set(network.chainId, network)
    }

    const stored = await this.#repository.findAll()

    for (const network of stored) {
      if (this.#isBuiltIn(network.chainId)) {
        this.#logger.warn('The stored copy of a built-in network was ignored', {
          chainId: network.chainId.toString(),
        })
        continue
      }

      this.#networks.set(network.chainId, network)
    }

    const storedActive = await this.#repository.getActiveChainId()

    /* The stored choice may have pointed at a removed user network. */
    this.#activeChainId =
      storedActive !== null && this.#networks.has(storedActive)
        ? storedActive
        : this.#defaultChainId

    this.#initialized = true

    this.#logger.info('Networks loaded', {
      total: this.#networks.size,
      activeChainId: this.#activeChainId.toString(),
    })
  }

  getActive(): INetworkConfig {
    this.#assertInitialized()

    const active = this.#networks.get(this.#activeChainId as ChainId)

    if (active === undefined) {
      /* Unreachable after a correct init(): the active id is always
         chosen from the loaded set. The check stays as a guard
         against state drift in later edits. */
      throw new NetworkNotFoundError(this.#activeChainId as ChainId)
    }

    return active
  }

  list(): readonly INetworkConfig[] {
    return [...this.#networks.values()]
  }

  getByChainId(chainId: ChainId): INetworkConfig | null {
    return this.#networks.get(chainId) ?? null
  }

  async switchTo(chainId: ChainId): Promise<void> {
    this.#assertInitialized()

    if (!this.#networks.has(chainId)) {
      throw new NetworkNotFoundError(chainId)
    }

    /* Switching again to the active network must not emit: listeners
       recreate the provider and drop caches on this signal. */
    if (this.#activeChainId === chainId) {
      return
    }

    await this.#repository.setActiveChainId(chainId)
    this.#activeChainId = chainId

    this.#logger.info('Active network changed', { chainId: chainId.toString() })
    this.#events.emit('network:changed', { chainId })
  }

  async add(params: IAddNetworkParams): Promise<INetworkConfig> {
    this.#assertInitialized()

    if (this.#networks.has(params.chainId)) {
      throw new NetworkAlreadyExistsError(params.chainId)
    }

    assertValidRpcUrls(params.rpcUrls)

    for (const url of params.blockExplorerUrls ?? []) {
      assertValidExplorerUrl(url)
    }

    /*
      The impersonation check runs BEFORE talking to the node.

      Order matters: checking chainId needs a network request and
      takes seconds, while a name match is visible at once. More
      importantly, a chainId check cannot catch this impersonation
      at all: the node will honestly confirm its id, and the check
      will pass.
    */
    const impersonation = findImpersonation(params, this.#builtInNetworks)

    if (impersonation !== null && params.allowImpersonation !== true) {
      throw new NetworkImpersonationError(
        impersonation.name,
        impersonation.impersonated.chainId,
        params.chainId,
        impersonation.foreignCharacters,
      )
    }

    const candidate: INetworkConfig = {
      chainId: params.chainId,
      name: params.name,
      nativeCurrency: params.nativeCurrency,
      rpcUrls: params.rpcUrls,
      blockExplorerUrls: params.blockExplorerUrls ?? [],
      isTestnet: params.isTestnet ?? false,
      isBuiltIn: false,
      /* EIP-1559 support is decided from the node response at the
         transaction stage. Until then a conservative guess is safer:
         an overstated fee estimate overpays, an understated one
         leaves a stuck transaction that must be replaced. */
      supportsEip1559: false,
    }

    await this.#verifyChainId(candidate)

    await this.#repository.save(candidate)
    this.#networks.set(candidate.chainId, candidate)

    this.#logger.info('Custom network added', {
      chainId: candidate.chainId.toString(),
    })
    this.#emitListChanged()

    return candidate
  }

  async remove(chainId: ChainId): Promise<void> {
    this.#assertInitialized()

    const existing = this.#networks.get(chainId)

    if (existing === undefined) {
      throw new NetworkNotFoundError(chainId)
    }

    if (existing.isBuiltIn) {
      throw new BuiltInNetworkImmutableError(chainId)
    }

    await this.#repository.delete(chainId)
    this.#networks.delete(chainId)

    this.#logger.info('Custom network removed', { chainId: chainId.toString() })
    this.#emitListChanged()

    /* Removing the active network must leave the app in a working
       state, not in "there is no active network". */
    if (this.#activeChainId === chainId) {
      await this.switchTo(this.#defaultChainId)
    }
  }

  async update(chainId: ChainId, params: Partial<IAddNetworkParams>): Promise<INetworkConfig> {
    this.#assertInitialized()

    const existing = this.#networks.get(chainId)

    if (existing === undefined) {
      throw new NetworkNotFoundError(chainId)
    }

    if (existing.isBuiltIn) {
      throw new BuiltInNetworkImmutableError(chainId)
    }

    if (params.rpcUrls !== undefined) {
      assertValidRpcUrls(params.rpcUrls)
    }

    for (const url of params.blockExplorerUrls ?? []) {
      assertValidExplorerUrl(url)
    }

    /* chainId is deliberately not taken from params: changing the
       id is another network, not an edit of the existing one.
       A silent reassignment would leave a record under the old
       key in storage. */
    const updated: INetworkConfig = {
      ...existing,
      name: params.name ?? existing.name,
      nativeCurrency: params.nativeCurrency ?? existing.nativeCurrency,
      rpcUrls: params.rpcUrls ?? existing.rpcUrls,
      blockExplorerUrls: params.blockExplorerUrls ?? existing.blockExplorerUrls,
      isTestnet: params.isTestnet ?? existing.isTestnet,
    }

    await this.#repository.save(updated)
    this.#networks.set(chainId, updated)

    this.#emitListChanged()

    return updated
  }

  on<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof NetworkEventMap>(
    event: TName,
    listener: EventListener<NetworkEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Checks the claimed chainId against the node's answer.
   *
   * The most important check in the module. Without it a site can
   * offer to add "the same network with a faster node", while the
   * node in fact serves another network. The user signs a
   * transaction believing it belongs to one network, and the
   * signature is fit to replay on another.
   *
   * The connection is closed either way: the service does not
   * hold providers.
   */
  async #verifyChainId(candidate: INetworkConfig): Promise<void> {
    const provider = await this.#providerFactory.create(candidate)

    try {
      const response = await provider.request<unknown>({ method: 'eth_chainId' })
      const actual = parseChainIdFromHex(response)

      if (actual !== candidate.chainId) {
        this.#logger.warn('The node reported a foreign chainId', {
          expected: candidate.chainId.toString(),
          actual: actual.toString(),
        })

        throw new ChainIdMismatchError(candidate.chainId, actual)
      }
    } finally {
      provider.destroy()
    }
  }

  #isBuiltIn(chainId: ChainId): boolean {
    return this.#builtInNetworks.some((network) => network.chainId === chainId)
  }

  #emitListChanged(): void {
    this.#events.emit('network:listChanged', {
      chainIds: [...this.#networks.keys()],
    })
  }

  #assertInitialized(): void {
    if (!this.#initialized || this.#activeChainId === null) {
      throw new NotInitializedError(SERVICE_NAME)
    }
  }
}
