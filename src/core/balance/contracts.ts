import type { IEventSource } from '@/core/events'
import type { ITokenRef } from '@/core/token'
import type { Address, ChainId, Unsubscribe } from '@/core/types'

import type { BalanceEventMap, IAccountBalances, IBalance } from './types'

/**
 * Obtaining and caching balances.
 *
 * A cache is required: asking for ten token balances on every UI
 * navigation will exhaust a public RPC node's limits in minutes.
 * But the cache must be explicit — see the `isStale` flag on
 * `IBalance`.
 *
 * The service formats nothing. The rationale is in the comment on
 * `IBalance`.
 */
export interface IBalanceService extends IEventSource<BalanceEventMap> {
  /**
   * Native-currency balance.
   *
   * Returns the cached value immediately if there is one, and
   * starts a background refresh. The updated value arrives as a
   * `balance:updated` event.
   */
  getNative(owner: Address, chainId: ChainId): Promise<IBalance>

  getToken(owner: Address, token: ITokenRef): Promise<IBalance>

  /**
   * Every balance of an address on a network.
   *
   * The implementation must batch requests (multicall or JSON-RPC
   * batch). Sequential one-by-one requests per token are dozens of
   * node calls for one screen.
   */
  getAll(owner: Address, chainId: ChainId): Promise<IAccountBalances>

  /**
   * Re-fetches balances, ignoring the cache.
   *
   * Called after a transaction is confirmed and on an explicit
   * user action.
   */
  refresh(owner: Address, chainId: ChainId): Promise<IAccountBalances>

  /**
   * Subscribes to automatic balance updates for an address.
   *
   * @returns Unsubscribe function. Must be called on unmount: a
   *          leftover subscription keeps polling the node.
   */
  subscribe(owner: Address, chainId: ChainId): Unsubscribe

  /** Clears the cache. Called on a network change and on lock. */
  invalidate(owner?: Address, chainId?: ChainId): void
}
