import type { ITokenRef } from '@/core/token'
import type { Address, ChainId, Timestamp } from '@/core/types'

/**
 * Balance of one token on one address.
 *
 * DELIBERATELY CONTAINS NO formatted string like `1.234 ETH`.
 *
 * Formatting depends on locale, the number of displayed decimals,
 * and user settings — i.e. it belongs to the presentation layer. A
 * `formatted` field in the domain model would mean the core decides
 * display and that a language change would require recomputing every
 * balance.
 *
 * The core returns `raw` and `decimals`. The UI does the conversion.
 */
export interface IBalance {
  readonly owner: Address
  readonly chainId: ChainId
  readonly token: ITokenRef

  /**
   * Value in the token's smallest units.
   *
   * Only `bigint`. Conversion to `number` at `decimals = 18` loses
   * precision already at amounts on the order of tenths of a token.
   */
  readonly raw: bigint

  /** Token decimal count. Duplicated here so the UI can format
      the value without resolving the token reference. */
  readonly decimals: number

  /** Instant the value was obtained. Needed to show stale data. */
  readonly updatedAt: Timestamp

  /**
   * The value came from the cache, not from the network.
   *
   * The UI must tell a current balance from a stored one: a send
   * decision based on a stale value leads to the network rejecting
   * the transaction.
   */
  readonly isStale: boolean
}

/** All balances of an address on one network. */
export interface IAccountBalances {
  readonly owner: Address
  readonly chainId: ChainId
  readonly native: IBalance
  readonly tokens: readonly IBalance[]
  readonly updatedAt: Timestamp
}

export interface BalanceEventMap {
  'balance:updated': {
    readonly owner: Address
    readonly chainId: ChainId
    readonly token: ITokenRef
  }
  'balance:refreshFailed': {
    readonly owner: Address
    readonly chainId: ChainId
    readonly reason: string
  }
}
