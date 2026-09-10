import { EventBus, type EventListener } from '@/core/events'
import { NetworkNotFoundError, NotImplementedError } from '@/core/errors'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProviderResolver } from '@/core/provider'
import type { ITokenRef, ITokenService } from '@/core/token'
import type { Address, ChainId, Timestamp, Unsubscribe, Wei } from '@/core/types'
import { mapWithLimit } from '@/shared/lib/concurrency'

import type { IBalanceService } from './contracts'
import type { BalanceEventMap, IAccountBalances, IBalance } from './types'

const SERVICE_NAME = 'BalanceService'

/**
 * How many token balances are requested at once.
 *
 * Four is the value at which an ordinary wallet with five to ten
 * tokens refreshes in two or three network delays instead of ten,
 * and the node does not start refusing for rate limits.
 */
const TOKEN_BALANCE_CONCURRENCY = 4

/**
 * How long a value is considered fresh.
 *
 * A block on EVM networks lands in seconds, but polling the node at
 * that rate is pointless: the balance changes only from the user's
 * own operations and incoming transfers. Fifteen seconds is a
 * compromise between noticing a change and load on a public node.
 */
const DEFAULT_FRESHNESS_MS = 15_000

/**
 * Background-poll period while a subscription is active.
 *
 * Noticeably longer than the freshness window: a subscription is
 * there so the value updates itself, not so it stays maximally
 * exact. More frequent polling of a public node reveals the user's
 * activity and hits the limits.
 */
const DEFAULT_POLL_INTERVAL_MS = 30_000

/** Reference to the network native currency: it has no contract. */
function nativeTokenRef(chainId: ChainId): ITokenRef {
  return { chainId, address: null }
}

export interface IBalanceServiceOptions {
  readonly freshnessMs?: number
  readonly pollIntervalMs?: number
}

export interface IBalanceServiceDependencies {
  /* A narrow "give me a connection" contract, not a concrete cache:
     the service does not care who reuses connections or how, and a
     class dependency would block replacing `ProviderPool` with
     `RpcManager` and failover. */
  readonly providers: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger

  /**
   * Token service.
   *
   * Optional: the service handles the native-currency balance
   * itself. Without it a token-balance request fails, it does not
   * return zero — zero would claim "there are no tokens".
   */
  readonly tokens?: ITokenService

  readonly options?: IBalanceServiceOptions
}

interface ICacheEntry {
  readonly raw: Wei
  readonly updatedAt: Timestamp
}

interface ISubscription {
  count: number
  cancel: Unsubscribe
}

/**
 * Native-currency balances with caching and background refresh.
 *
 * SCOPE. The native currency is read and cached here; token
 * balances go through `ITokenService`, which can talk to contracts.
 * Only the native balance is cached for now: the token list changes
 * less often, but its values are re-fetched on every refresh.
 *
 * `getToken` DOES NOT RETURN ZERO ON FAILURE. A zero balance is the
 * claim "there are no tokens", and a user who sees it instead of a
 * failure will decide the funds vanished. Unavailability must look
 * like unavailability.
 *
 * A STALE VALUE IS RETURNED, BUT MARKED. The `isStale` flag is not
 * decoration: a send decision based on a stored value leads to the
 * network refusing. The UI must show the stale mark.
 */
export class BalanceService implements IBalanceService {
  readonly #providers: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #tokens: ITokenService | null
  readonly #freshnessMs: number
  readonly #pollIntervalMs: number

  readonly #events = new EventBus<BalanceEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Balance event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  readonly #cache = new Map<string, ICacheEntry>()
  readonly #subscriptions = new Map<string, ISubscription>()

  /* In-flight node requests. Two screens that asked for the same
     balance at once share one network call. */
  readonly #inFlight = new Map<string, Promise<Wei>>()

  constructor(dependencies: IBalanceServiceDependencies) {
    this.#providers = dependencies.providers
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#tokens = dependencies.tokens ?? null
    this.#freshnessMs = dependencies.options?.freshnessMs ?? DEFAULT_FRESHNESS_MS
    this.#pollIntervalMs = dependencies.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  async getNative(owner: Address, chainId: ChainId): Promise<IBalance> {
    const cached = this.#cache.get(cacheKey(owner, chainId))

    if (cached !== undefined && this.#isFresh(cached)) {
      return this.#toBalance(owner, chainId, cached, false)
    }

    if (cached !== undefined) {
      /* The stale value is returned immediately; the refresh runs
         in the background. An empty screen instead of the previous
         balance looks like a loss of funds. */
      void this.#refreshInBackground(owner, chainId)

      return this.#toBalance(owner, chainId, cached, true)
    }

    return this.#toBalance(owner, chainId, await this.#fetch(owner, chainId), false)
  }

  /**
   * Token balance.
   *
   * @throws NotImplementedError if the token service is not wired:
   *         returning zero would claim "there are no tokens", which
   *         the wallet cannot check in this state.
   */
  async getToken(owner: Address, token: ITokenRef): Promise<IBalance> {
    if (token.address === null) {
      return await this.getNative(owner, token.chainId)
    }

    if (this.#tokens === null) {
      throw new NotImplementedError(`${SERVICE_NAME}.getToken`)
    }

    const known = this.#tokens.get(token)

    return {
      owner,
      chainId: token.chainId,
      token,
      raw: await this.#tokens.getBalance(token, owner),
      /* Decimals come from the metadata that was read. Absence from
         the list means there is nowhere to read them: substituting
         the usual eighteen would distort the amount by orders of
         magnitude. */
      decimals:
        known?.decimals ??
        (await this.#tokens.fetchMetadata(token.chainId, token.address)).decimals,
      updatedAt: this.#clock.now(),
      isStale: false,
    }
  }

  /**
   * Every balance of an address on a network: native currency and
   * tracked tokens.
   *
   * A failure for one token does not cancel the rest: the contract
   * may have been removed or stopped answering, and losing the
   * whole list because of it is worse than showing an incomplete
   * one.
   */
  async getAll(owner: Address, chainId: ChainId): Promise<IAccountBalances> {
    const native = await this.getNative(owner, chainId)

    return {
      owner,
      chainId,
      native,
      tokens: await this.#loadTokenBalances(owner, chainId),
      updatedAt: native.updatedAt,
    }
  }

  async refresh(owner: Address, chainId: ChainId): Promise<IAccountBalances> {
    const entry = await this.#fetch(owner, chainId)
    const native = this.#toBalance(owner, chainId, entry, false)

    return {
      owner,
      chainId,
      native,
      tokens: await this.#loadTokenBalances(owner, chainId),
      updatedAt: native.updatedAt,
    }
  }

  /**
   * Balances of tracked tokens.
   *
   * CONCURRENCY IS CAPPED, NOT REMOVED. Requests used to go strictly
   * one by one: ten tokens meant ten network delays in a row.
   * `Promise.all` is the other extreme: public nodes rate-limit and
   * refuse instead of returning a balance, and a dozen simultaneous
   * calls also hands an observer the whole portfolio in one packet.
   *
   * A batched multicall is faster than either, but requires trust
   * in a separate contract — that is a separate decision.
   *
   * A FAILURE FOR ONE TOKEN DOES NOT TAKE THE OTHERS OFF THE
   * SCREEN: an unavailable contract has no right to erase the
   * balances of the rest.
   */
  async #loadTokenBalances(owner: Address, chainId: ChainId): Promise<readonly IBalance[]> {
    const tokens = this.#tokens

    if (tokens === null) {
      return []
    }

    const tracked = tokens.list(chainId).filter((token) => token.address !== null)

    const settled = await mapWithLimit(
      tracked.map((token) => async () => await tokens.getBalance(token, owner)),
      TOKEN_BALANCE_CONCURRENCY,
    )

    const balances: IBalance[] = []

    tracked.forEach((token, index) => {
      const result = settled[index]

      if (result === undefined || token.address === null) {
        return
      }

      if (result.status === 'rejected') {
        this.#logger.warn('Token balance is unavailable', {
          chainId,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })

        return
      }

      balances.push({
        owner,
        chainId,
        token: { chainId, address: token.address },
        raw: result.value,
        decimals: token.decimals,
        updatedAt: this.#clock.now(),
        isStale: false,
      })
    })

    return balances
  }

  subscribe(owner: Address, chainId: ChainId): Unsubscribe {
    const key = cacheKey(owner, chainId)
    const existing = this.#subscriptions.get(key)

    if (existing !== undefined) {
      /* Count subscribers, do not give each a timer: three widgets
         on one screen would poll the node three times as often. */
      existing.count += 1

      return () => {
        this.#unsubscribe(key)
      }
    }

    const cancel = this.#clock.setInterval(() => {
      void this.#refreshInBackground(owner, chainId)
    }, this.#pollIntervalMs)

    this.#subscriptions.set(key, { count: 1, cancel })

    return () => {
      this.#unsubscribe(key)
    }
  }

  invalidate(owner?: Address, chainId?: ChainId): void {
    if (owner === undefined && chainId === undefined) {
      this.#cache.clear()

      return
    }

    for (const key of [...this.#cache.keys()]) {
      if (matchesKey(key, owner, chainId)) {
        this.#cache.delete(key)
      }
    }
  }

  on<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /** Stops every poll. Called when the wallet is locked. */
  stop(): void {
    for (const subscription of this.#subscriptions.values()) {
      subscription.cancel()
    }

    this.#subscriptions.clear()
    this.#cache.clear()
  }

  #unsubscribe(key: string): void {
    const subscription = this.#subscriptions.get(key)

    if (subscription === undefined) {
      return
    }

    subscription.count -= 1

    if (subscription.count > 0) {
      return
    }

    subscription.cancel()
    this.#subscriptions.delete(key)
  }

  async #fetch(owner: Address, chainId: ChainId): Promise<ICacheEntry> {
    const key = cacheKey(owner, chainId)
    const pending = this.#inFlight.get(key)

    if (pending !== undefined) {
      return { raw: await pending, updatedAt: this.#clock.now() }
    }

    const request = this.#requestBalance(owner, chainId)

    this.#inFlight.set(key, request)

    try {
      const entry: ICacheEntry = { raw: await request, updatedAt: this.#clock.now() }

      this.#cache.set(key, entry)
      this.#events.emit('balance:updated', {
        owner,
        chainId,
        token: nativeTokenRef(chainId),
      })

      return entry
    } finally {
      this.#inFlight.delete(key)
    }
  }

  async #requestBalance(owner: Address, chainId: ChainId): Promise<Wei> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    const provider = await this.#providers.get(network)

    return await provider.getBalance(owner)
  }

  /**
   * Refreshes the balance without throwing outward.
   *
   * A background refresh is started without awaiting the result.
   * An unhandled rejection here would reach the global handler and
   * in a Manifest V3 service worker would look like a failure of
   * the whole extension.
   */
  async #refreshInBackground(owner: Address, chainId: ChainId): Promise<void> {
    try {
      await this.#fetch(owner, chainId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The balance could not be refreshed', { chainId, reason })
      this.#events.emit('balance:refreshFailed', { owner, chainId, reason })
    }
  }

  #isFresh(entry: ICacheEntry): boolean {
    return this.#clock.now() - entry.updatedAt < this.#freshnessMs
  }

  #toBalance(owner: Address, chainId: ChainId, entry: ICacheEntry, isStale: boolean): IBalance {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return {
      owner,
      chainId,
      token: nativeTokenRef(chainId),
      raw: entry.raw,
      decimals: network.nativeCurrency.decimals,
      updatedAt: entry.updatedAt,
      isStale,
    }
  }
}

function cacheKey(owner: Address, chainId: ChainId): string {
  /* The address is forced to lower case: the same address arrives
     both in EIP-55 checksum and in lower case from RPC responses,
     and two spellings would give two cache entries with diverging
     values. */
  return `${owner.toLowerCase()}:${String(chainId)}`
}

function matchesKey(key: string, owner?: Address, chainId?: ChainId): boolean {
  const [keyOwner = '', keyChain = ''] = key.split(':')

  if (owner !== undefined && keyOwner !== owner.toLowerCase()) {
    return false
  }

  return chainId === undefined || keyChain === String(chainId)
}
