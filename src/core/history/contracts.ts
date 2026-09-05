import type { IProvider } from '@/core/provider'
import type { Address, ChainId } from '@/core/types'

import type { IHistoryCursor, IHistoryPage } from './types'

/** History query parameters. */
export interface IHistoryQuery {
  readonly owner: Address
  readonly chainId: ChainId

  /**
   * Upper bound on the number of records.
   *
   * The cap is required: an address that took part in a token drop
   * has tens of thousands of transfers, and trying to fetch them
   * all would exhaust the tab's memory.
   */
  readonly limit: number

  /**
   * Continuation of a previous page.
   *
   * Absence means the first page — from the newest records.
   */
  readonly cursor?: IHistoryCursor | null | undefined
}

/**
 * A transfer-history source.
 *
 * THE TWO IMPLEMENTATIONS SOLVE DIFFERENT PROBLEMS AND DO NOT
 * DUPLICATE EACH OTHER.
 *
 * A node-log scan works everywhere and needs no key, but
 * fundamentally cannot see native-currency transfers: they emit
 * no events and are not in the logs. Public nodes also cap the
 * query range, so only a recent window is available.
 *
 * An indexer returns the full history of every category, but
 * receives the user's address and returns their entire financial
 * life — the operator learns portfolio size, counterparties, and
 * the time of every operation at once. That is noticeably more
 * than an ordinary RPC node sees, and the wallet owner decides
 * whether to make that trade.
 */
export interface IHistoryProvider {
  readonly id: string
  readonly name: string

  supports(chainId: ChainId): boolean

  /**
   * Fetches history.
   *
   * @param provider Connection to the node. Passed in so the
   *        source does not start its own transport and follows
   *        the shared failover to a backup node.
   */
  fetch(query: IHistoryQuery, provider: IProvider): Promise<IHistoryPage>
}
