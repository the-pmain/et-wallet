import type { TokenStandard } from '@/core/token'
import type { Address, ChainId } from '@/core/types'

/**
 * A live allowance to spend the owner's funds.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. Funds today are taken not
 * by stealing a key, but by a forgotten allowance: the user once
 * let a contract spend tokens with no amount cap, and a year later
 * that contract was hacked or belonged to a scammer from the start.
 * The key is intact, the wallet is "not compromised", and the
 * funds are gone.
 *
 * THE ALLOWANCE IS CHECKED AT QUERY TIME, not inferred from the
 * log. The log shows a history of grants; a revoked allowance
 * stays there forever. Showing it as live would scare the owner
 * with something that is not there.
 */
export interface IApprovalRecord {
  readonly chainId: ChainId

  /** Token or collection contract address. */
  readonly contract: Address

  /** Who is allowed to spend. */
  readonly spender: Address

  readonly standard: TokenStandard

  /**
   * Allowed amount in the smallest units.
   *
   * `null` for a whole-collection allowance: there is no amount —
   * every item can be spent, including future ones.
   */
  readonly amount: bigint | null

  /**
   * The allowance is not capped.
   *
   * Apps request this by default so they need not ask for a
   * signature before every operation. The price is access to
   * the entire token balance forever.
   */
  readonly isUnlimited: boolean

  /** Token symbol from the contract. `null` if the contract does not return one. */
  readonly symbol: string | null

  /** Token decimals. `null` — the raw amount is shown as-is. */
  readonly decimals: number | null
}

/** How the shown allowance list is bounded. */
export interface IApprovalLimits {
  /** How many blocks were scanned back from the latest. */
  readonly scannedBlocks: number | null

  /** The source did not answer. An empty list then asserts nothing. */
  readonly sourceUnavailable: boolean

  /** Rejection reason verbatim. `null` if there was no rejection. */
  readonly reason: string | null

  /**
   * How many found grants were left unchecked.
   *
   * Checking each one needs a separate contract call, and the
   * number of checks is capped. Zero means "everything was checked".
   */
  readonly skipped: number
}

/** Allowance list together with the sample bounds. */
export interface IApprovalPage {
  readonly items: readonly IApprovalRecord[]
  readonly limits: IApprovalLimits
}
