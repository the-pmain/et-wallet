import { areAddressesEqual } from '@/core/address'
import type { INetworkService } from '@/core/network'
import { NetworkNotFoundError } from '@/core/errors'
import type { ILogger } from '@/core/platform'
import type { IProviderResolver } from '@/core/provider'
import { decodeTransfer } from '@/core/token'
import type { ITransactionRecord, ITransactionRepository } from '@/core/transaction'
import { toWei, type Address, type ChainId, type TxHash, type Wei } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryCursor,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const SERVICE_NAME = 'HistoryService'

const DEFAULT_LIMIT = 50

export interface IHistoryOptions {
  readonly limit?: number

  /**
   * Continuation of a previous page.
   *
   * Absence means the first page — from the newest records.
   */
  readonly cursor?: IHistoryCursor | null
}

export interface IHistoryServiceDependencies {
  /**
   * History sources in preference order.
   *
   * The first that serves the network and answers without a reject
   * decides the result. Order is set from outside: it expresses the
   * choice between completeness and privacy, and that is application
   * policy, not a property of the mechanism.
   */
  readonly providers: readonly IHistoryProvider[]

  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger

  /** Local sends. Always mixed in. */
  readonly localRepository: ITransactionRepository
}

/**
 * Combined transfer history.
 *
 * LOCAL RECORDS ARE ALWAYS MIXED IN. A sent transaction lands in
 * local storage at once, and in an external source after inclusion
 * in a block and reindexing. Without local records a user who sent
 * funds would not see them in history for several minutes and would
 * decide the send did not happen.
 *
 * DUPLICATES ARE DROPPED BY HASH. When the external source finally
 * returns the same transaction, the local record yields: the
 * external one has a block number, a time, and a confirmed state.
 */
export class HistoryService {
  readonly #providers: readonly IHistoryProvider[]
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #local: ITransactionRepository

  constructor(dependencies: IHistoryServiceDependencies) {
    this.#providers = dependencies.providers
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#local = dependencies.localRepository
  }

  /**
   * Transfer history of an address on a network.
   *
   * A reject from an external source does not fail the whole
   * operation: local records are returned either way. Empty history
   * because the network is down would look like an absence of
   * operations.
   */
  async getHistory(
    owner: Address,
    chainId: ChainId,
    options: IHistoryOptions = {},
  ): Promise<IHistoryPage> {
    const limit = options.limit ?? DEFAULT_LIMIT
    const cursor = options.cursor ?? null

    /* OWN SENDS ARE MIXED IN ONLY ON THE FIRST PAGE.
       They belong to no stretch of history and are stored in full
       here; repeating them on every page would make a pending send
       reappear after every "show earlier". */
    const local = cursor === null ? await this.#loadLocal(owner, chainId) : []
    const remote = await this.#loadRemote({ owner, chainId, limit, cursor })

    if (remote.page === null) {
      return {
        transfers: local.slice(0, limit),
        limits: {
          nativeTransfersUnavailable: false,
          scannedBlocks: null,
          /* No external source answered. Only own sends are shown,
             and that must be said plainly: otherwise an empty list
             reads as "there were no operations". */
          sourceUnavailable: true,
          reason: remote.reason,
        },
        /* The token is returned unchanged: a source reject does not
           mean there is no continuation, and a retry must start
           from the same place. */
        cursor,
      }
    }

    return {
      transfers: merge(local, remote.page.transfers).slice(0, limit),
      limits: remote.page.limits,
      cursor: remote.page.cursor,
    }
  }

  async #loadLocal(owner: Address, chainId: ChainId): Promise<readonly ITransferRecord[]> {
    const records = await this.#local.findByAddress(owner, chainId)

    return records.map((record) => {
      const transfer = describeLocal(record)

      return {
        /* The key is built the same way as external sources: hash
           plus an ordinal. A local record describes the whole
           transaction, so the ordinal is zero. */
        id: `${record.hash}:local`,
        hash: record.hash,
        chainId: record.chainId,
        kind: transfer.kind,
        direction: TRANSFER_DIRECTION.Outgoing,
        from: record.from,
        to: transfer.to,
        value: transfer.value,
        tokenId: null,
        asset: { contract: transfer.contract, symbol: null, decimals: null },
        blockNumber: record.blockNumber ?? 0n,
        timestamp: record.confirmedAt ?? record.submittedAt,
        source: TRANSFER_SOURCE.Local,
        /* State is taken from the transaction record: that is what
           distinguishes pending from done, reverted, and replaced. */
        status: record.status,
      }
    })
  }

  /**
   * The first source that serves the network and answers without a reject.
   *
   * The last source's reject reason is returned with the result: it
   * is shown to the user verbatim. A generic "history unavailable"
   * would not tell them what to do, while a node message "specify
   * a contract address" points straight at the remedy — connect
   * your own node or an indexer.
   */
  async #loadRemote(
    query: IHistoryQuery,
  ): Promise<{ page: IHistoryPage | null; reason: string | null }> {
    const network = this.#networks.getByChainId(query.chainId)

    if (network === null) {
      throw new NetworkNotFoundError(query.chainId)
    }

    let lastReason: string | null = null

    for (const provider of this.#providers) {
      if (!provider.supports(query.chainId)) {
        continue
      }

      /* CONTINUATION IS SERVED ONLY BY THE SOURCE THAT ISSUED THE TOKEN.
         If we moved to the next one, it would read a foreign token as
         the start of a page and return the newest records disguised
         as earlier ones: the list would continue with what is already
         shown, and the person would decide there is no further history. */
      const cursor = query.cursor ?? null

      if (cursor !== null && cursor.providerId !== provider.id) {
        continue
      }

      try {
        return {
          page: await provider.fetch(query, await this.#resolver.get(network)),
          reason: null,
        }
      } catch (error) {
        /* A reject from one source is a reason to try the next, not
           to deprive the user of history. The reason goes to the log
           and outward: a silent fallback would hide a broken indexer
           key or a node that does not accept log queries. */
        lastReason = error instanceof Error ? error.message : String(error)

        this.#logger.warn('The history source is unavailable', {
          providerId: provider.id,
          reason: lastReason,
        })
      }
    }

    return { page: null, reason: lastReason }
  }
}

/**
 * Merges local and external records.
 *
 * A local record is dropped if the same hash arrived from outside:
 * the external one has a block number, a time, and a confirmed
 * state; the local one is only the intent to send.
 */
function merge(
  local: readonly ITransferRecord[],
  remote: readonly ITransferRecord[],
): readonly ITransferRecord[] {
  const remoteHashes = new Set<TxHash>(remote.map((record) => record.hash))
  const pendingLocal = local.filter((record) => !remoteHashes.has(record.hash))

  return [...remote, ...pendingLocal].sort(compareByRecency)
}

/**
 * Newest-first sort.
 *
 * Records with no block number — sends not yet included — go first:
 * those are what the user waits for and looks for by eye.
 */
function compareByRecency(left: ITransferRecord, right: ITransferRecord): number {
  if (left.blockNumber === 0n && right.blockNumber !== 0n) {
    return -1
  }

  if (right.blockNumber === 0n && left.blockNumber !== 0n) {
    return 1
  }

  if (left.blockNumber !== right.blockNumber) {
    return Number(right.blockNumber - left.blockNumber)
  }

  return (right.timestamp ?? 0) - (left.timestamp ?? 0)
}

export function isOwner(candidate: Address | null, owner: Address): boolean {
  return candidate !== null && areAddressesEqual(candidate, owner)
}

/**
 * What an own transaction actually transferred.
 *
 * READ FROM THE SIGNED DATA, NOT FROM THE INTENT. On a token
 * transfer the `to` field points at the contract, the native
 * amount is zero, and the real recipient and quantity sit in the
 * call data. Showing such a record from the transaction fields
 * would tell the user about a transfer of zero to nobody.
 *
 * Parsing the data, rather than a separate field on the record,
 * is a deliberate choice: history then holds exactly what went
 * on-chain. If the form and the signature diverged, the record
 * shows the actual contents.
 */
function describeLocal(record: ITransactionRecord): {
  readonly kind: TransferKind
  readonly to: Address | null
  readonly value: Wei
  readonly contract: Address | null
} {
  const call = record.data === null ? null : decodeTransfer(record.data)

  if (call === null || record.to === null) {
    return { kind: TRANSFER_KIND.Native, to: record.to, value: record.value, contract: null }
  }

  return {
    kind: TRANSFER_KIND.Erc20,
    to: call.to,
    value: toWei(call.amount),
    contract: record.to,
  }
}
