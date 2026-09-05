import type { IAccountManager } from '@/core/account'
import type { IBalanceService } from '@/core/balance'
import type { IEventSource } from '@/core/events'
import type { INetworkService } from '@/core/network'
import type { IProvider } from '@/core/provider'
import type { ITokenService } from '@/core/token'
import type { ITransactionService } from '@/core/transaction'
import type { IWallet } from '@/core/wallet'

import type { WalletCoreEventMap } from './types'

/**
 * Core facade: the single entry point for the features and pages layers.
 *
 * What it does:
 * - exposes services as properties;
 * - owns the core lifecycle (`init`, `destroy`);
 * - aggregates every subsystem's events into one source;
 * - owns the auto-lock policy, because it touches the whole core.
 *
 * What it does NOT do: hold domain rules. Every method either
 * delegates to a service or manages lifecycle. The first "if the
 * balance is lower, then" that lands here starts turning the facade
 * into a God Object and the services into anemic data structures.
 *
 * Why services are properties, not proxied methods: proxying fifty
 * methods would add fifty lines that contribute nothing except
 * another place for signatures to drift. Composition is more honest
 * than delegation here.
 */
export interface IWalletManager extends IEventSource<WalletCoreEventMap> {
  readonly wallet: IWallet
  readonly accounts: IAccountManager
  readonly networks: INetworkService
  readonly tokens: ITokenService
  readonly balances: IBalanceService
  readonly transactions: ITransactionService

  /**
   * Initialises the core.
   *
   * Order is required: storage with migrations, then networks (a
   * provider is needed), then the wallet, then accounts and tokens.
   * Breaking the order means talking to a provider before a network
   * is chosen.
   *
   * Idempotent: a second call does not initialise again.
   */
  init(): Promise<void>

  /**
   * Provider of the active network.
   *
   * `null` if a connection is not yet established or every node is
   * unreachable. A method, not a property: the provider is recreated
   * on a network change and on a node failure, so a stored reference
   * is not allowed.
   */
  getProvider(): IProvider | null

  /**
   * Resets the auto-lock timer.
   *
   * Called by the UI layer on user activity. The core does not
   * subscribe to DOM events itself: a service worker of the
   * extension has no DOM, and such a subscription would make the
   * core unportable.
   */
  notifyActivity(): void

  /**
   * Stops the core: locks the wallet, closes the provider, removes
   * subscriptions and timers.
   *
   * Must be called when the app unloads. An unclosed provider keeps
   * polling the node, and leftover subscriptions retain handler
   * references.
   */
  destroy(): Promise<void>
}
