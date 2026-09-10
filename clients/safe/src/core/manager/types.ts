import type { AccountEventMap } from '@/core/account'
import type { BalanceEventMap } from '@/core/balance'
import type { NetworkEventMap } from '@/core/network'
import type { TokenEventMap } from '@/core/token'
import type { TransactionEventMap } from '@/core/transaction'
import type { WalletEventMap } from '@/core/wallet'

/**
 * Combined event map of the core.
 *
 * A union instead of a facade-owned set: the events are already
 * defined in their modules, and duplicating them would desynchronise
 * the names. Name collisions are impossible — each space uses its
 * own prefix (`wallet:`, `account:`, `network:`, and so on).
 *
 * One event source is enough for a subscriber to receive everything
 * that happens in the core.
 */
export type WalletCoreEventMap = AccountEventMap &
  BalanceEventMap &
  NetworkEventMap &
  TokenEventMap &
  TransactionEventMap &
  WalletEventMap

export interface IWalletCoreConfig {
  /**
   * Idle time before automatic lock, in milliseconds.
   *
   * 0 disables auto-lock. Disabling is allowed only as a conscious
   * user choice: an unlocked wallet on an unattended device can
   * sign a transaction without a password.
   */
  readonly autoLockTimeoutMs: number

  /** Network active on first launch. */
  readonly defaultChainId: bigint

  /** Background balance-refresh period, in milliseconds. */
  readonly balanceRefreshIntervalMs: number

  /**
   * Minimum password length.
   *
   * A length check is a necessary but insufficient minimum. The
   * full complexity policy is decided when unlock is implemented.
   */
  readonly minPasswordLength: number
}
