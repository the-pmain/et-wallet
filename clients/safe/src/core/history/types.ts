import type { TransactionStatus } from '@/core/transaction'

import type { Address, ChainId, Timestamp, TxHash } from '@/core/types'

/** What was transferred. */
export const TRANSFER_KIND = {
  Native: 'native',
  Erc20: 'erc20',
  Erc721: 'erc721',
  /** ERC-1155 token: fungible and unique in one contract. */
  Erc1155: 'erc1155',
} as const

export type TransferKind = (typeof TRANSFER_KIND)[keyof typeof TRANSFER_KIND]

/** Direction relative to the account whose history was requested. */
export const TRANSFER_DIRECTION = {
  Incoming: 'incoming',
  Outgoing: 'outgoing',
  /** Sender and recipient are the same account. */
  Self: 'self',
} as const

export type TransferDirection = (typeof TRANSFER_DIRECTION)[keyof typeof TRANSFER_DIRECTION]

/**
 * Token details that accompany a transfer.
 *
 * EVERY FIELD MAY BE ABSENT, AND THAT IS NOT EXCEPTIONAL.
 * A contract need not implement `symbol()` and `decimals()`: they
 * are the optional part of ERC-20. The history source may also
 * omit them.
 *
 * `decimals: null` MUST BE HANDLED SEPARATELY. Substituting the
 * familiar eighteen places for an unknown value distorts the
 * amount by orders of magnitude: a transfer of 1000 USDC (six
 * decimals) would become 0.000000000001. The UI should show the
 * raw units with an explicit mark.
 */
export interface ITransferAsset {
  /** Contract address. `null` for the native currency. */
  readonly contract: Address | null

  /**
   * Symbol.
   *
   * UNTRUSTED VALUE: the contract author sets it, and nothing
   * stops anyone from shipping a token with an existing symbol.
   * The UI must distinguish verified tokens from arbitrary ones.
   */
  readonly symbol: string | null

  /** Decimal places. `null` if the contract did not report them. */
  readonly decimals: number | null
}

/**
 * One history record.
 *
 * THIS IS NOT A TRANSACTION, IT IS A TRANSFER. One transaction
 * yields several transfers: a token swap is at least two, a
 * drop is hundreds. The key is the pair "transaction hash +
 * ordinal inside it", not the hash alone.
 */
export interface ITransferRecord {
  /** Stable record id: hash plus the number inside the transaction. */
  readonly id: string

  readonly hash: TxHash
  readonly chainId: ChainId
  readonly kind: TransferKind
  readonly direction: TransferDirection

  readonly from: Address
  /** `null` on a token mint or a contract deploy. */
  readonly to: Address | null

  /**
   * Amount in the smallest units.
   *
   * Always one for ERC-721: a unique item does not divide.
   */
  readonly value: bigint

  /** Item id. Filled for ERC-721 and ERC-1155. */
  readonly tokenId: bigint | null

  readonly asset: ITransferAsset

  /**
   * Transfer state.
   *
   * For records from an indexer and from node logs this is always
   * "confirmed": they exist only because they already landed in a
   * block. The field gains meaning for the wallet's own sends —
   * it distinguishes "waiting to be included", "done", "reverted",
   * and "replaced by another transaction".
   *
   * A REVERTED OPERATION IS NOT A SUCCESS. Gas was spent, there
   * was no transfer, and it must not be shown on a par with one
   * that completed.
   */
  readonly status: TransactionStatus

  readonly blockNumber: bigint

  /**
   * Time of inclusion in a block.
   *
   * `null` if the source did not report it: the node does not
   * return time with the log, and fetching the block header for
   * every record is dozens of extra calls for one screen.
   */
  readonly timestamp: Timestamp | null

  /** Where the record came from. Shown to the user. */
  readonly source: TransferSource
}

/** Where the record was obtained. */
export const TRANSFER_SOURCE = {
  /** The wallet's own send, stored locally. */
  Local: 'local',
  /** Indexer: full history, including native transfers. */
  Indexer: 'indexer',
  /** Node-log scan: tokens only, a bounded window. */
  Logs: 'logs',
} as const

export type TransferSource = (typeof TRANSFER_SOURCE)[keyof typeof TRANSFER_SOURCE]

/** What bounds the history that was received. */
export interface IHistoryLimits {
  /**
   * Native transfers are unavailable to the source.
   *
   * True for a log scan: a native-currency transfer emits no
   * event and is physically absent from the logs.
   */
  readonly nativeTransfersUnavailable: boolean

  /**
   * History is bounded by a window in blocks.
   *
   * `null` means the full history. The block count is reported
   * so the UI can honestly say which period the data covers.
   */
  readonly scannedBlocks: number | null

  /**
   * No source answered.
   *
   * DISTINGUISHING THIS FROM AN EMPTY HISTORY IS REQUIRED.
   * "There were no operations" and "could not find out" are
   * different claims, and the second, presented as the first,
   * reads to the owner as missing funds.
   *
   * Not a hypothetical case: public nodes refuse a log query
   * without a contract, and that is exactly the query needed
   * to find transfers of every token at once.
   */
  readonly sourceUnavailable: boolean

  /** Source rejection reason. Shown to the user verbatim. */
  readonly reason: string | null
}

/**
 * Continuation token for the next page.
 *
 * OPAQUE TO THE CALLER. Sources continue differently: a log scan
 * shifts the block window, an indexer returns its own page key.
 * Those values have no common representation, and inventing one
 * would couple the caller to the internals of both sources.
 *
 * THE SOURCE NAME IS STORED BESIDE THE VALUE, because the token
 * must be parsed by the same source that issued it. An indexer
 * page key fed to a log scan would be read as a block number —
 * and the next page would come from another place in history,
 * with no sign of the substitution.
 */
export interface IHistoryCursor {
  readonly providerId: string
  readonly value: string
}

/** History query result. */
export interface IHistoryPage {
  readonly transfers: readonly ITransferRecord[]
  readonly limits: IHistoryLimits

  /**
   * How to continue the page. `null` — nothing to continue with.
   *
   * DISTINGUISHING "NOTHING FURTHER" FROM "WE DID NOT ASK FURTHER"
   * IS REQUIRED. An empty page with a continuation token means
   * the scanned stretch is empty, not that there were no
   * operations: a log scan's first window is easily empty with
   * a full history behind it.
   */
  readonly cursor: IHistoryCursor | null
}
