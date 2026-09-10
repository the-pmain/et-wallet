import { TRANSACTION_STATUS } from '@/core/transaction'

import { areAddressesEqual, isValidAddress, toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { IProvider } from '@/core/provider'
import type { Address, ChainId, Timestamp, TxHash } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import { hexToBigInt } from './transfer-events'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryCursor,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const PROVIDER_ID = 'alchemy'
const PROVIDER_NAME = 'Alchemy indexer'

const METHOD = 'alchemy_getAssetTransfers'

/**
 * Requested categories.
 *
 * `external` — ordinary native-currency transfers, `internal` —
 * transfers a contract made inside a transaction. Those two
 * categories are unreachable by a log scan: they emit no events.
 */
const CATEGORIES: readonly string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155']

/** Networks the indexer serves. Match the RPC source's networks. */
const SUPPORTED: ReadonlySet<ChainId> = new Set([
  BUILT_IN_CHAIN_ID.Ethereum,
  BUILT_IN_CHAIN_ID.Optimism,
  BUILT_IN_CHAIN_ID.BnbChain,
  BUILT_IN_CHAIN_ID.Polygon,
  BUILT_IN_CHAIN_ID.Base,
  BUILT_IN_CHAIN_ID.Arbitrum,
  BUILT_IN_CHAIN_ID.Avalanche,
])

/**
 * Transfer history through the Alchemy indexer.
 *
 * WHAT WE GET. The full history of every category, including native
 * transfers and internal contract transfers, for the whole life of
 * the address. A log scan cannot reach that.
 *
 * WHAT WE PAY. The indexer operator receives the user's address and
 * returns their entire financial history. They learn portfolio size,
 * every counterparty, and the time of every operation — at once,
 * not as requests arrive, as with an ordinary RPC node.
 * The wallet owner decides whether to make that trade, and the UI
 * must show which source was used.
 *
 * WHY THE AMOUNT IS TAKEN FROM `rawContract.value`, NOT FROM `value`.
 * `value` arrives as a JSON number, i.e. binary floating point: a
 * balance of 0.1 tokens is not representable exactly, and amounts
 * past 2^53 lose the low digits entirely. For money that is not
 * acceptable. `rawContract.value` holds the raw units as a hex
 * string and converts to `bigint` without loss.
 */
export class AlchemyHistoryProvider implements IHistoryProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  supports(chainId: ChainId): boolean {
    return SUPPORTED.has(chainId)
  }

  async fetch(query: IHistoryQuery, provider: IProvider): Promise<IHistoryPage> {
    const position = resolvePosition(query.cursor)

    /* The indexer cannot combine "sender OR recipient", so there
       are two queries. They run in parallel: sequential ones would
       double the wait on a screen opened for a quick look.

       ON CONTINUATION AN EXHAUSTED QUERY IS NOT REPEATED. An address
       has different counts of received and sent, and without this
       the shorter side would serve its first page again on every
       "show earlier". */
    const [sent, received] = await Promise.all([
      position.isFirstPage || position.sent !== null
        ? this.#request(provider, query, 'fromAddress', position.sent)
        : EMPTY_BATCH,
      position.isFirstPage || position.received !== null
        ? this.#request(provider, query, 'toAddress', position.received)
        : EMPTY_BATCH,
    ])

    const transfers = [...sent.transfers, ...received.transfers]
      .flatMap((raw) => this.#toRecords(raw, query))
      .sort((left, right) => Number(right.blockNumber - left.blockNumber))

    return {
      transfers: dedupeById(transfers).slice(0, query.limit),
      limits: {
        nativeTransfersUnavailable: false,
        scannedBlocks: null,
        sourceUnavailable: false,
        reason: null,
      },
      cursor: encodeCursor(sent.pageKey, received.pageKey),
    }
  }

  async #request(
    provider: IProvider,
    query: IHistoryQuery,
    direction: 'fromAddress' | 'toAddress',
    pageKey: string | null,
  ): Promise<IRawBatch> {
    const response = await provider.request<unknown>({
      method: METHOD,
      params: [
        {
          fromBlock: '0x0',
          toBlock: 'latest',
          [direction]: query.owner,
          category: CATEGORIES,
          withMetadata: true,
          excludeZeroValue: false,
          order: 'desc',
          maxCount: `0x${query.limit.toString(16)}`,
          ...(pageKey === null ? {} : { pageKey }),
        },
      ],
    })

    return { transfers: extractTransfers(response), pageKey: extractPageKey(response) }
  }

  /**
   * Turns an indexer record into history records.
   *
   * One ERC-1155 event can carry several items, so a list is
   * returned, not a single record.
   */
  #toRecords(raw: IRawTransfer, query: IHistoryQuery): readonly ITransferRecord[] {
    const kind = toKind(raw.category)

    if (kind === null || !isValidAddress(raw.from)) {
      return []
    }

    const from = toAddress(raw.from)
    const to = raw.to !== null && isValidAddress(raw.to) ? toAddress(raw.to) : null
    const base = {
      hash: raw.hash as TxHash,
      chainId: query.chainId,
      kind,
      direction: resolveDirection(from, to, query.owner),
      from,
      to,
      asset: {
        contract:
          raw.contractAddress !== null && isValidAddress(raw.contractAddress)
            ? toAddress(raw.contractAddress)
            : null,
        symbol: raw.asset,
        decimals: raw.decimals,
      },
      blockNumber: raw.blockNumber,
      timestamp: raw.timestamp,
      source: TRANSFER_SOURCE.Indexer,
      /* The record exists only because it already landed in a block. */
      status: TRANSACTION_STATUS.Confirmed,
    }

    if (raw.erc1155Items.length > 0) {
      return raw.erc1155Items.map((item, index) => ({
        ...base,
        id: `${raw.uniqueId}:${String(index)}`,
        value: item.value,
        tokenId: item.tokenId,
      }))
    }

    return [
      {
        ...base,
        id: raw.uniqueId,
        /* For ERC-721 the amount is always one: a unique item does
           not divide, and the indexer does not fill the amount field. */
        value: kind === TRANSFER_KIND.Erc721 ? 1n : raw.rawValue,
        tokenId: raw.tokenId,
      },
    ]
  }
}

interface IRawBatch {
  readonly transfers: readonly IRawTransfer[]

  readonly pageKey: string | null
}

const EMPTY_BATCH: IRawBatch = { transfers: [], pageKey: null }

interface IPosition {
  readonly isFirstPage: boolean
  readonly sent: string | null
  readonly received: string | null
}

/**
 * Parses a continuation token.
 *
 * A foreign or corrupted token means the first page: showing the
 * start of history again is better than refusing it entirely.
 */
function resolvePosition(cursor: IHistoryQuery['cursor']): IPosition {
  if (cursor === null || cursor === undefined || cursor.providerId !== PROVIDER_ID) {
    return { isFirstPage: true, sent: null, received: null }
  }

  try {
    const parsed = asRecord(JSON.parse(cursor.value)) ?? {}

    return {
      isFirstPage: false,
      sent: readString(parsed, 'sent'),
      received: readString(parsed, 'received'),
    }
  } catch {
    return { isFirstPage: true, sent: null, received: null }
  }
}

function encodeCursor(sent: string | null, received: string | null): IHistoryCursor | null {
  if (sent === null && received === null) {
    return null
  }

  return {
    providerId: PROVIDER_ID,
    value: JSON.stringify({
      ...(sent === null ? {} : { sent }),
      ...(received === null ? {} : { received }),
    }),
  }
}

/**
 * Next-page key from the response.
 *
 * Absence of the field is an end-of-page mark set by the indexer,
 * not a guess from the record count: the last page may well be full.
 */
function extractPageKey(response: unknown): string | null {
  const record = asRecord(response)

  return record === null ? null : readString(record, 'pageKey')
}

interface IRawTransfer {
  readonly uniqueId: string
  readonly hash: string
  readonly category: string
  readonly from: string
  readonly to: string | null
  readonly rawValue: bigint
  readonly tokenId: bigint | null
  readonly erc1155Items: readonly { tokenId: bigint; value: bigint }[]
  readonly contractAddress: string | null
  readonly asset: string | null
  readonly decimals: number | null
  readonly blockNumber: bigint
  readonly timestamp: Timestamp | null
}

/**
 * Parses an indexer response.
 *
 * The response is UNTRUSTED: this is an external service, and its
 * format can change without notice. Each field is checked on its
 * own, and records that fail are dropped silently. Throwing here
 * would mean one corrupted record deprives the user of all history.
 */
function extractTransfers(response: unknown): readonly IRawTransfer[] {
  if (typeof response !== 'object' || response === null) {
    return []
  }

  const { transfers } = response as { transfers?: unknown }

  if (!Array.isArray(transfers)) {
    return []
  }

  const parsed: IRawTransfer[] = []

  for (const entry of transfers as readonly unknown[]) {
    const record = parseTransfer(entry)

    if (record !== null) {
      parsed.push(record)
    }
  }

  return parsed
}

function parseTransfer(entry: unknown): IRawTransfer | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const value = entry as Record<string, unknown>
  const uniqueId = readString(value, 'uniqueId')
  const hash = readString(value, 'hash')
  const category = readString(value, 'category')
  const from = readString(value, 'from')
  const blockNum = readString(value, 'blockNum')

  if (uniqueId === null || hash === null || category === null || from === null) {
    return null
  }

  const rawContract = asRecord(field(value, 'rawContract'))

  return {
    uniqueId,
    hash,
    category,
    from,
    to: readString(value, 'to'),
    rawValue: rawContract === null ? 0n : hexToBigInt(readString(rawContract, 'value') ?? '0x0'),
    tokenId: parseTokenId(value),
    erc1155Items: parseErc1155(field(value, 'erc1155Metadata')),
    contractAddress: rawContract === null ? null : readString(rawContract, 'address'),
    asset: readString(value, 'asset'),
    decimals: parseDecimals(rawContract),
    blockNumber: blockNum === null ? 0n : hexToBigInt(blockNum),
    timestamp: parseTimestamp(field(value, 'metadata')),
  }
}

/**
 * Decimal count.
 *
 * Absence of the field means "unknown" and is passed as `null`.
 * Substituting the familiar eighteen is not allowed: a token with
 * six decimals shown as eighteen would understate the amount a
 * trillionfold.
 */
function parseDecimals(rawContract: Record<string, unknown> | null): number | null {
  if (rawContract === null) {
    return null
  }

  const decimal = readString(rawContract, 'decimal')

  if (decimal === null) {
    return null
  }

  const parsed = Number(hexToBigInt(decimal))

  return Number.isFinite(parsed) ? parsed : null
}

function parseTokenId(value: Record<string, unknown>): bigint | null {
  const raw = readString(value, 'erc721TokenId') ?? readString(value, 'tokenId')

  if (raw === null) {
    return null
  }

  try {
    return hexToBigInt(raw)
  } catch {
    return null
  }
}

function parseErc1155(value: unknown): readonly { tokenId: bigint; value: bigint }[] {
  if (!Array.isArray(value)) {
    return []
  }

  const items: { tokenId: bigint; value: bigint }[] = []

  for (const entry of value as readonly unknown[]) {
    const record = asRecord(entry)
    const tokenId = record === null ? null : readString(record, 'tokenId')
    const amount = record === null ? null : readString(record, 'value')

    if (tokenId === null) {
      continue
    }

    items.push({ tokenId: hexToBigInt(tokenId), value: amount === null ? 1n : hexToBigInt(amount) })
  }

  return items
}

function parseTimestamp(metadata: unknown): Timestamp | null {
  const record = asRecord(metadata)
  const value = record === null ? null : readString(record, 'blockTimestamp')

  if (value === null) {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : (parsed as Timestamp)
}

function toKind(category: string): TransferKind | null {
  switch (category) {
    case 'external':
    case 'internal':
      return TRANSFER_KIND.Native
    case 'erc20':
      return TRANSFER_KIND.Erc20
    case 'erc721':
      return TRANSFER_KIND.Erc721
    case 'erc1155':
      return TRANSFER_KIND.Erc1155
    default:
      return null
  }
}

function resolveDirection(from: Address, to: Address | null, owner: Address) {
  const isOutgoing = areAddressesEqual(from, owner)
  const isIncoming = to !== null && areAddressesEqual(to, owner)

  if (isOutgoing && isIncoming) {
    return TRANSFER_DIRECTION.Self
  }

  return isOutgoing ? TRANSFER_DIRECTION.Outgoing : TRANSFER_DIRECTION.Incoming
}

/**
 * Reads a field of an untrusted object.
 *
 * A helper, not direct access: `noPropertyAccessFromIndexSignature`
 * requires bracket notation for fields whose existence the type
 * does not guarantee. That is the right requirement — it stops
 * a parsed structure being confused with a raw third-party response.
 */
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return asString(field(record, key))
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function dedupeById(records: readonly ITransferRecord[]): readonly ITransferRecord[] {
  const seen = new Map<string, ITransferRecord>()

  for (const record of records) {
    seen.set(record.id, record)
  }

  return [...seen.values()]
}
