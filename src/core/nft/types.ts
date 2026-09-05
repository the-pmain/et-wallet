import type { TokenStandard } from '@/core/token'
import type { Address, ChainId } from '@/core/types'

/**
 * A collectible belonging to an address.
 *
 * OWNERSHIP IS CHECKED AT QUERY TIME, not inferred from the fact
 * that the item once arrived at the address. The transfer log
 * shows history, not current state: an item received yesterday
 * and given away today stays in the log forever. Showing it as
 * owned would tell the owner they have property they do not.
 */
export interface INftItem {
  readonly chainId: ChainId

  /** Collection contract address. */
  readonly contract: Address

  /** Item number inside the collection. */
  readonly tokenId: bigint

  readonly standard: TokenStandard

  /**
   * How many copies belong to the owner.
   *
   * Always one for ERC-721: the item is indivisible and exists
   * in a single copy. ERC-1155 can be more — the same id is
   * issued in a run.
   */
  readonly balance: bigint

  /**
   * Collection name from the contract. `null` if the contract does not return one.
   *
   * UNTRUSTED VALUE: the contract author sets it, and anyone can
   * name their collection after a well-known one. The UI must
   * show the contract address beside it — the only thing that
   * distinguishes the genuine item from a fake.
   */
  readonly collectionName: string | null

  /** Short collection label. `null` if the contract does not return one. */
  readonly collectionSymbol: string | null
}

/**
 * How the shown item list is bounded.
 *
 * AN INCOMPLETE LIST PRESENTED AS COMPLETE READS AS A THEFT.
 * An owner who cannot find their item will decide it was stolen —
 * so the sample bounds are named plainly and always.
 */
export interface INftLimits {
  /**
   * How many blocks were scanned back from the latest.
   *
   * Items received before this window and not moved since are
   * absent from the list: their arrival stayed outside the sample.
   */
  readonly scannedBlocks: number | null

  /** The source did not answer. The list is then empty, but that does not mean "empty". */
  readonly sourceUnavailable: boolean

  /**
   * How many found items were left unchecked.
   *
   * Ownership of each item needs a separate contract call. An
   * address with hundreds of arrivals is hundreds of requests —
   * public-node limits and minutes of waiting — so the number
   * of checks is capped. Skipped items are not shown, and not
   * silenced either: zero here means "everything was checked".
   */
  readonly skipped: number

  /** Source rejection reason verbatim. `null` if there was no rejection. */
  readonly reason: string | null
}

/** Item list together with the sample bounds. */
export interface INftPage {
  readonly items: readonly INftItem[]
  readonly limits: INftLimits
}
