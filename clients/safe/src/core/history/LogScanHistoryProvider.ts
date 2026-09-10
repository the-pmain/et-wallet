import { TRANSACTION_STATUS } from '@/core/transaction'

import { areAddressesEqual } from '@/core/address'
import type { ILogEntry, IProvider } from '@/core/provider'
import type { Address, ChainId, HexString } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  splitDataWords,
  topicToAddress,
} from './transfer-events'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryCursor,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const PROVIDER_ID = 'logs'
const PROVIDER_NAME = 'Node logs'

/**
 * Query depth in blocks.
 *
 * Public nodes limit the `eth_getLogs` range; ten thousand blocks is
 * a value almost all of them accept. On Ethereum that is about a day
 * and a half, on fast networks — a few hours.
 *
 * Raising it is pointless: the node will refuse, and history will be
 * empty instead of short.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/** Result of one log query: either records or a refusal reason. */
interface IScanBatch {
  readonly logs: readonly ILogEntry[]
  readonly error: string | null
}

/** Topic count of an ERC-721 event: the event id plus three parameters. */
const ERC721_TOPIC_COUNT = 4

/** Source settings. */
export interface ILogScanOptions {
  readonly scanBlocks?: number
}

/** Where the previous scan stopped. */
interface IScanPosition {
  /** Upper block of the next window, inclusive. */
  readonly ceiling: bigint

  /** How many blocks were scanned across all previous pages. */
  readonly scanned: number
}

function encodeCursor(ceiling: bigint, scanned: number): IHistoryCursor {
  return { providerId: PROVIDER_ID, value: `${ceiling.toString()}:${scanned.toString()}` }
}

/**
 * History from node logs.
 *
 * WHAT THIS SOURCE CANNOT SEE. A native-currency transfer emits no
 * event and is physically absent from the logs. No setting will
 * change that: finding those transfers would mean walking every
 * block whole or using tracing, which public nodes do not provide.
 *
 * The limit is reported to the caller via `nativeTransfersUnavailable`,
 * not silenced: an empty list without explanation reads as "there
 * were no transfers".
 *
 * WHY IT IS NEEDED THEN. It works on any node and without a key,
 * i.e. it does not require sending the user's address to a
 * third-party service. For someone who values privacy above
 * completeness, that is the only acceptable option.
 */
export class LogScanHistoryProvider implements IHistoryProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  readonly #scanBlocks: number

  constructor(options: ILogScanOptions = {}) {
    this.#scanBlocks = options.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  supports(_chainId: ChainId): boolean {
    /* Logs exist on every EVM network: the source does not depend on
       the operator. */
    return true
  }

  async fetch(query: IHistoryQuery, provider: IProvider): Promise<IHistoryPage> {
    const position = this.#resolvePosition(query.cursor)
    /* The latest block number is needed only on the first page:
       later pages have the window ceiling set by the cursor. An extra
       node request here would clarify nothing — the network has
       moved on, and a re-read would shift the window and leave a
       gap. */
    const ceiling = position?.ceiling ?? (await provider.getBlockNumber())
    /* THE WINDOW CONTAINS EXACTLY `scanBlocks` BLOCKS, INCLUDING THE
       LAST. Subtracting the full depth made a window one block wider
       than declared, and nodes with a limit of exactly ten thousand
       answered "range too wide". Checked live: a Polygon node
       refused exactly our request, even though the limit matched
       our depth. */
    const span = BigInt(this.#scanBlocks) - 1n
    const fromBlock = ceiling > span ? ceiling - span : 0n
    const latest = ceiling
    const ownerTopic = addressToTopic(query.owner)

    /* Six queries: sent and received, separately for three event
       families. They cannot be merged into one — the address
       position in topics differs between ERC-20 and ERC-1155. */
    const requests: readonly (readonly (HexString | null)[])[] = [
      [TRANSFER_TOPIC, ownerTopic],
      [TRANSFER_TOPIC, null, ownerTopic],
      [TRANSFER_SINGLE_TOPIC, null, ownerTopic],
      [TRANSFER_SINGLE_TOPIC, null, null, ownerTopic],
      [TRANSFER_BATCH_TOPIC, null, ownerTopic],
      [TRANSFER_BATCH_TOPIC, null, null, ownerTopic],
    ]

    /*
      QUERIES RUN IN SEQUENCE, NOT IN PARALLEL.

      There used to be a `Promise.all` here, and it looked like a
      harmless optimization: six requests instead of six waits. But
      the library batches concurrent calls into one JSON-RPC packet,
      and from the outside that became a request with six heavy log
      queries at once.

      Measured live on the gateway that serves those queries: a
      packet of six — "429, rate limit exceeded"; the same six
      requests in sequence — all six at 180 milliseconds. So the
      node was not refusing the query itself, it was refusing six at
      once, and history looked unavailable.

      The cost of the queue is about a second instead of a third. For
      a screen opened to look at transfers, that is incomparable to
      history not showing at all.
    */
    const batches: IScanBatch[] = []

    for (const topics of requests) {
      batches.push(await this.#getLogs(provider, fromBlock, latest, topics))
    }

    /*
      REFUSAL OF EVERY QUERY IS A SOURCE FAILURE, NOT EMPTY HISTORY.

      Public nodes refuse a log query without a contract, and that
      is exactly the query needed to find transfers of every token
      at once. Swallowing that refusal would tell the owner "there
      were no operations" — i.e. a claim about their funds that was
      not checked.

      The error is thrown so the caller can move to the next source,
      and if there is none, show the real reason.
    */
    const failure = batches.find((batch) => batch.error !== null)

    if (batches.every((batch) => batch.error !== null) && failure !== undefined) {
      throw new Error(failure.error ?? 'the node refused the log query')
    }

    const transfers = batches
      .flatMap((batch) => batch.logs)
      /* A log cancelled by a chain reorganization must disappear,
         not stay in history as a completed transfer. */
      .filter((log) => !log.removed)
      .flatMap((log) => this.#toRecords(log, query))

    /* Scanned from the start of the scan, not for one page: after
       the third "show earlier" click a "scanned ten thousand
       blocks" label would be wrong by a factor of three. */
    const scannedBlocks = Number(latest - fromBlock + 1n) + (position?.scanned ?? 0)

    return {
      transfers: dedupeById(transfers).slice(0, query.limit),
      limits: {
        nativeTransfersUnavailable: true,
        scannedBlocks,
        sourceUnavailable: false,
        /* Some queries may have failed: history is incomplete, and
           that is reported, not silenced. */
        reason: failure?.error ?? null,
      },
      /* Block zero is the start of the chain: there is nowhere to continue. */
      cursor: fromBlock === 0n ? null : encodeCursor(fromBlock - 1n, scannedBlocks),
    }
  }

  /**
   * Parses a continuation cursor.
   *
   * A FOREIGN OR CORRUPT CURSOR STARTS THE SCAN OVER, rather than
   * causing a failure. Freshly shown records will be dropped by key
   * further up the stack, whereas an exception would leave the user
   * with an error message instead of history.
   */
  #resolvePosition(cursor: IHistoryQuery['cursor']): IScanPosition | null {
    if (cursor === null || cursor === undefined || cursor.providerId !== PROVIDER_ID) {
      return null
    }

    const [ceiling, scanned] = cursor.value.split(':')

    try {
      return {
        ceiling: BigInt(ceiling ?? ''),
        scanned: Number(scanned ?? '0'),
      }
    } catch {
      return null
    }
  }

  /**
   * Requests logs, keeping the refusal reason instead of losing it.
   *
   * Refusal of one query does not kill the rest: a node may accept
   * a request for one event family and refuse another. But the
   * reason is remembered — a silent empty result is indistinguishable
   * from no operations.
   */
  async #getLogs(
    provider: IProvider,
    fromBlock: bigint,
    toBlock: bigint,
    topics: readonly (HexString | null)[],
  ): Promise<IScanBatch> {
    try {
      return { logs: await provider.getLogs({ fromBlock, toBlock, topics }), error: null }
    } catch (error) {
      return { logs: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Turns a log entry into history records. */
  #toRecords(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [topic] = log.topics

    if (topic === TRANSFER_TOPIC) {
      return this.#fromTransfer(log, query)
    }

    if (topic === TRANSFER_SINGLE_TOPIC) {
      return this.#fromTransferSingle(log, query)
    }

    if (topic === TRANSFER_BATCH_TOPIC) {
      return this.#fromTransferBatch(log, query)
    }

    return []
  }

  /**
   * `Transfer` — ERC-20 or ERC-721.
   *
   * THEY ARE DISTINGUISHED BY TOPIC COUNT, not by contents. On
   * ERC-721 the item id is indexed and occupies the fourth topic;
   * on ERC-20 the amount lives in data, and there are only three
   * topics. That is the only sign: the type is not in the event.
   */
  #fromTransfer(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, fromTopic, toTopic, tokenIdTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const isErc721 = log.topics.length === ERC721_TOPIC_COUNT && tokenIdTopic !== undefined
    const from = topicToAddress(fromTopic)
    const to = topicToAddress(toTopic)

    return [
      this.#buildRecord({
        log,
        query,
        kind: isErc721 ? TRANSFER_KIND.Erc721 : TRANSFER_KIND.Erc20,
        from,
        to,
        value: isErc721 ? 1n : (splitDataWords(log.data)[0] ?? 0n),
        tokenId: isErc721 && tokenIdTopic !== undefined ? BigInt(tokenIdTopic) : null,
        index: 0,
      }),
    ]
  }

  /** `TransferSingle` — one ERC-1155 item. */
  #fromTransferSingle(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, , fromTopic, toTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const [tokenId = 0n, value = 0n] = splitDataWords(log.data)

    return [
      this.#buildRecord({
        log,
        query,
        kind: TRANSFER_KIND.Erc1155,
        from: topicToAddress(fromTopic),
        to: topicToAddress(toTopic),
        value,
        tokenId,
        index: 0,
      }),
    ]
  }

  /**
   * `TransferBatch` — a set of ERC-1155 items in one event.
   *
   * Data contains two variable-length arrays in ABI encoding: first
   * the offsets, then the lengths and the values. Parsing is
   * simplified to reading lengths and consecutive elements — enough
   * for events where both arrays sit next to each other, as the
   * reference implementation forms them.
   */
  #fromTransferBatch(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, , fromTopic, toTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const words = splitDataWords(log.data)
    const idsLength = Number(words[2] ?? 0n)

    if (idsLength === 0 || idsLength > words.length) {
      return []
    }

    const from = topicToAddress(fromTopic)
    const to = topicToAddress(toTopic)
    const records: ITransferRecord[] = []

    for (let item = 0; item < idsLength; item += 1) {
      const tokenId = words[3 + item]
      /* The second array follows the first: its length, then values. */
      const value = words[3 + idsLength + 1 + item]

      if (tokenId === undefined || value === undefined) {
        break
      }

      records.push(
        this.#buildRecord({
          log,
          query,
          kind: TRANSFER_KIND.Erc1155,
          from,
          to,
          value,
          tokenId,
          index: item,
        }),
      )
    }

    return records
  }

  #buildRecord(params: {
    log: ILogEntry
    query: IHistoryQuery
    kind: TransferKind
    from: Address
    to: Address
    value: bigint
    tokenId: bigint | null
    index: number
  }): ITransferRecord {
    const { log, query, kind, from, to, value, tokenId, index } = params
    const isOutgoing = areAddressesEqual(from, query.owner)
    const isIncoming = areAddressesEqual(to, query.owner)

    return {
      /* The key includes the log index and the ordinal inside the
         event: one transaction produces dozens of transfers, and the
         hash is not enough. */
      id: `${log.transactionHash}:${String(log.logIndex)}:${String(index)}`,
      hash: log.transactionHash,
      chainId: query.chainId,
      kind,
      direction:
        isOutgoing && isIncoming
          ? TRANSFER_DIRECTION.Self
          : isOutgoing
            ? TRANSFER_DIRECTION.Outgoing
            : TRANSFER_DIRECTION.Incoming,
      from,
      to,
      value,
      tokenId,
      asset: {
        contract: log.address,
        /* The log contains neither the symbol nor the decimals.
           Asking the contract for them on every record is hundreds
           of calls per screen; `null` honestly means "unknown". */
        symbol: null,
        decimals: null,
      },
      blockNumber: log.blockNumber,
      timestamp: null,
      source: TRANSFER_SOURCE.Logs,
      /* The record exists only because it is already in a block. */
      status: TRANSACTION_STATUS.Confirmed,
    }
  }
}

/** Drops duplicates: one transfer lands in both the "sent" and "received" queries. */
function dedupeById(records: readonly ITransferRecord[]): readonly ITransferRecord[] {
  const seen = new Map<string, ITransferRecord>()

  for (const record of records) {
    seen.set(record.id, record)
  }

  return [...seen.values()].sort((left, right) => Number(right.blockNumber - left.blockNumber))
}
