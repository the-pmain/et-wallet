import type { ISecureStorage } from '@/core/encryption'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import { toChainId, type Address, type ChainId, type Timestamp, type TxHash } from '@/core/types'

import type { ITransactionRepository } from './contracts'
import {
  TRANSACTION_STATUS,
  type ITransactionRecord,
  type TransactionStatus,
  type TransactionType,
} from './types'

/**
 * A history record in a JSON-fit form.
 *
 * WHY A SEPARATE TYPE. `JSON.stringify` throws on `bigint` instead
 * of converting it. Relying on automatic serialization of the
 * domain record is not allowed: adding one more money field would
 * silently break history persistence.
 *
 * All large numbers are stored as decimal strings. Hex would be
 * more compact, but needs agreement on sign and leading zeros.
 */
interface IStoredRecord {
  readonly hash: string
  readonly chainId: string
  readonly from: string
  readonly to: string | null
  readonly value: string
  readonly nonce: number
  readonly status: string
  readonly type: string
  readonly submittedAt: number
  readonly confirmedAt: number | null
  readonly blockNumber: string | null
  readonly gasUsed: string | null
  readonly effectiveGasPrice: string | null
  readonly replacedBy: string | null

  /**
   * Confirmation count.
   *
   * Optional for records saved before tracking existed: those read
   * without it are treated as unconfirmed, and do not break
   * parsing. The wallet must open storage created by a previous
   * version — otherwise an app update would mean lost history.
   */
  readonly confirmations?: number

  readonly data?: string | null
  readonly gasLimit?: string | null
  readonly maxFeePerGas?: string | null
  readonly maxPriorityFeePerGas?: string | null
  readonly gasPrice?: string | null
}

/**
 * Transaction history in encrypted storage.
 *
 * WHY IT IS ENCRYPTED. A transaction is public by itself: it sits
 * on the chain and is visible to anyone. But the wallet's
 * transaction list ties together every user address and reveals
 * counterparties, amounts, and times of activity. A locked wallet
 * must not disclose that.
 *
 * THE RECORD KEY IS THE HASH, NOT AN ORDINAL. The hash is unique
 * and known in advance, so saving the same transaction again
 * updates the record instead of creating a duplicate. An ordinal
 * would need a separate counter that drifts under concurrent writes.
 *
 * LIMIT OF THE CURRENT STAGE. The repository stores only
 * transactions sent by this wallet. The full history of an
 * address, including incoming transfers, is not read from the
 * node: `eth_getLogs` returns only contract events, and native
 * transfers emit none. Full history needs an external indexer,
 * and that discloses every user address to a third-party service
 * — a decision that requires the owner's consent.
 */
export class TransactionRepository implements ITransactionRepository {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  async findByAddress(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    const index = await this.#readIndex()
    const hashes = index.byOwner[ownerKey(address, chainId)]

    /* Absence of the key means "this address was not seen in the
       index". That is not the same as "there is no index": it was
       already built above, and the build reads everything in storage. */
    const records = await this.#readByHashes(hashes ?? [])

    return [...records].sort((left, right) => right.submittedAt - left.submittedAt)
  }

  async findByHash(hash: TxHash): Promise<ITransactionRecord | null> {
    const stored = await this.#storage.get<IStoredRecord>(
      STORAGE_NAMESPACE.Transactions,
      recordKey(hash),
    )

    return stored === null ? null : decode(stored)
  }

  async findPending(chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    const index = await this.#readIndex()
    const records = await this.#readByHashes(index.unsettled)

    return records.filter(
      (record) => record.chainId === chainId && record.status === TRANSACTION_STATUS.Pending,
    )
  }

  async findUnsettled(maxConfirmations: number): Promise<readonly ITransactionRecord[]> {
    /* Only unsettled records are read: there are few of them, while
       all records may be thousands. Tracking hits this every twelve
       seconds, and a full read would cost tens of milliseconds of
       decryption on every pass. */
    const index = await this.#readIndex()
    const records = await this.#readByHashes(index.unsettled)

    return records.filter((record) => {
      if (record.status === TRANSACTION_STATUS.Pending) {
        return true
      }

      /* A replaced transaction is final: its slot is taken, and
         there is nothing to put it back on the chain with. */
      if (record.status === TRANSACTION_STATUS.Replaced) {
        return false
      }

      /* Included in a block, but not deep: a reorg is still possible. */
      return record.confirmations < maxConfirmations
    })
  }

  async save(record: ITransactionRecord): Promise<void> {
    /* THE RECORD IS SAVED FIRST. The index is an accelerator, not
       the source of truth: a record without an index is found when
       it is rebuilt, and an index without a record would be a
       pointer into the void. */
    await this.#storage.set(STORAGE_NAMESPACE.Transactions, recordKey(record.hash), encode(record))
    await this.#updateIndex(record)
  }

  async updateStatus(hash: TxHash, status: TransactionStatus): Promise<void> {
    const existing = await this.findByHash(hash)

    if (existing === null) {
      return
    }

    await this.save({ ...existing, status })
  }

  async deleteByAddress(address: Address): Promise<void> {
    const records = await this.#readAll()
    const removed = new Set<string>()

    for (const record of records) {
      if (record.from.toLowerCase() === address.toLowerCase()) {
        await this.#storage.remove(STORAGE_NAMESPACE.Transactions, recordKey(record.hash))
        removed.add(record.hash.toLowerCase())
      }
    }

    if (removed.size === 0) {
      return
    }

    /* The index is rebuilt in full, not patched: deletion is rare,
       and building from already-read records costs nothing. */
    await this.#writeIndex(
      buildIndex(records.filter((record) => !removed.has(record.hash.toLowerCase()))),
    )
  }

  /**
   * Index: where to find records without reading them all.
   *
   * WHY. Records sit encrypted one by one, and a full read decrypts
   * each. Measurement before the index: a hundred records — eight
   * milliseconds, five hundred — seventy. Tracking asked for
   * unsettled every twelve seconds, so the cost grew linearly and
   * was paid constantly.
   *
   * THE INDEX IS AN ACCELERATOR, NOT THE SOURCE OF TRUTH. Its
   * absence loses nothing: it is rebuilt by a full read — the
   * same path that was the only one before. Therefore the record
   * is saved first, and the index is updated after it.
   */
  async #readIndex(): Promise<IStoredIndex> {
    const stored = await this.#storage.get<IStoredIndex>(STORAGE_NAMESPACE.Transactions, INDEX_KEY)

    if (stored !== null && stored.version === INDEX_VERSION) {
      return stored
    }

    /* There is no index, or its format changed. Rebuilding is the
       only way not to lose records made by a previous version. */
    const index = buildIndex(await this.#readAll())

    await this.#writeIndex(index)

    return index
  }

  async #writeIndex(index: IStoredIndex): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Transactions, INDEX_KEY, index)
  }

  async #updateIndex(record: ITransactionRecord): Promise<void> {
    const index = await this.#readIndex()
    const key = ownerKey(record.from, record.chainId)
    const hash = record.hash.toLowerCase()

    const owned = index.byOwner[key] ?? []
    const byOwner = owned.includes(hash)
      ? index.byOwner
      : { ...index.byOwner, [key]: [...owned, hash] }

    /* Settled records leave the watch list and stop being read
       on every pass. */
    const unsettled = isUnsettled(record)
      ? index.unsettled.includes(hash)
        ? index.unsettled
        : [...index.unsettled, hash]
      : index.unsettled.filter((item) => item !== hash)

    await this.#writeIndex({ version: INDEX_VERSION, byOwner, unsettled })
  }

  async #readByHashes(hashes: readonly string[]): Promise<readonly ITransactionRecord[]> {
    const records: ITransactionRecord[] = []

    for (const hash of hashes) {
      const stored = await this.#storage.get<IStoredRecord>(
        STORAGE_NAMESPACE.Transactions,
        toStorageKey(`tx.${hash}`),
      )

      /* The record may be gone: the index outlives a deletion done
         around the repository. A pointer into the void is not an
         error — it is simply skipped. */
      if (stored !== null) {
        records.push(decode(stored))
      }
    }

    return records
  }

  async #readAll(): Promise<readonly ITransactionRecord[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Transactions)
    const records: ITransactionRecord[] = []

    for (const key of keys) {
      /* The index lives in the same namespace and is not a
         transaction record. */
      if (key === INDEX_KEY) {
        continue
      }

      const stored = await this.#storage.get<IStoredRecord>(STORAGE_NAMESPACE.Transactions, key)

      if (stored !== null) {
        records.push(decode(stored))
      }
    }

    return records
  }
}

function recordKey(hash: TxHash): StorageKey {
  return toStorageKey(`tx.${hash.toLowerCase()}`)
}

function encode(record: ITransactionRecord): IStoredRecord {
  return {
    hash: record.hash,
    chainId: record.chainId.toString(),
    from: record.from,
    to: record.to,
    value: record.value.toString(),
    nonce: record.nonce,
    status: record.status,
    type: record.type,
    submittedAt: record.submittedAt,
    confirmedAt: record.confirmedAt,
    blockNumber: record.blockNumber === null ? null : record.blockNumber.toString(),
    gasUsed: record.gasUsed === null ? null : record.gasUsed.toString(),
    effectiveGasPrice:
      record.effectiveGasPrice === null ? null : record.effectiveGasPrice.toString(),
    replacedBy: record.replacedBy,
    confirmations: record.confirmations,
    data: record.data,
    gasLimit: record.gasLimit === null ? null : record.gasLimit.toString(),
    maxFeePerGas: record.maxFeePerGas === null ? null : record.maxFeePerGas.toString(),
    maxPriorityFeePerGas:
      record.maxPriorityFeePerGas === null ? null : record.maxPriorityFeePerGas.toString(),
    gasPrice: record.gasPrice === null ? null : record.gasPrice.toString(),
  }
}

function decode(stored: IStoredRecord): ITransactionRecord {
  return {
    hash: stored.hash as TxHash,
    chainId: toChainId(BigInt(stored.chainId)),
    from: stored.from as Address,
    to: stored.to as Address | null,
    value: BigInt(stored.value) as ITransactionRecord['value'],
    nonce: stored.nonce,
    status: stored.status as TransactionStatus,
    type: stored.type as TransactionType,
    submittedAt: stored.submittedAt as Timestamp,
    confirmedAt: stored.confirmedAt as Timestamp | null,
    blockNumber: stored.blockNumber === null ? null : BigInt(stored.blockNumber),
    gasUsed: stored.gasUsed === null ? null : BigInt(stored.gasUsed),
    effectiveGasPrice: stored.effectiveGasPrice === null ? null : BigInt(stored.effectiveGasPrice),
    replacedBy: stored.replacedBy as TxHash | null,
    confirmations: stored.confirmations ?? 0,
    data: (stored.data ?? null) as ITransactionRecord['data'],
    gasLimit: toBigIntOrNull(stored.gasLimit),
    maxFeePerGas: toBigIntOrNull(stored.maxFeePerGas),
    maxPriorityFeePerGas: toBigIntOrNull(stored.maxPriorityFeePerGas),
    gasPrice: toBigIntOrNull(stored.gasPrice),
  }
}

function toBigIntOrNull(value: string | null | undefined): bigint | null {
  return value === null || value === undefined ? null : BigInt(value)
}

/** Index format version. Changing the value rebuilds it. */
const INDEX_VERSION = 1

const INDEX_KEY = toStorageKey('index.v1')

interface IStoredIndex {
  readonly version: number

  readonly byOwner: Readonly<Record<string, readonly string[]>>

  readonly unsettled: readonly string[]
}

function ownerKey(address: Address, chainId: ChainId): string {
  return `${chainId.toString()}:${address.toLowerCase()}`
}

/**
 * Depth from which a record drops out of the watch index.
 *
 * DELIBERATELY ABOVE ANY PRACTICAL THRESHOLD. The transaction
 * layer sets the threshold (currently three confirmations) and
 * may change it; the index survives those changes only if it
 * filters something strictly larger. Twelve blocks is a depth
 * below which reorgs on EVM networks after the move to
 * Proof-of-Stake are not observed.
 *
 * THE MARGIN WORKS IN THE SAFE DIRECTION: extra records stay
 * in the index, needed ones do not vanish. An extra costs one
 * read per pass; a missing one would mean the wallet stopped
 * watching a transaction.
 */
const INDEX_SETTLED_DEPTH = 12

/**
 * Whether the record still needs watching.
 *
 * Only the final is filtered out: replaced records and those that
 * went deep enough on the chain. Without the second condition the
 * watch index would match the whole history, and its gain would
 * vanish: measurement showed the same thirty milliseconds on five
 * hundred records.
 */
function isUnsettled(record: ITransactionRecord): boolean {
  if (record.status === TRANSACTION_STATUS.Replaced) {
    return false
  }

  if (record.status === TRANSACTION_STATUS.Pending) {
    return true
  }

  return record.confirmations < INDEX_SETTLED_DEPTH
}

function buildIndex(records: readonly ITransactionRecord[]): IStoredIndex {
  const byOwner: Record<string, string[]> = {}
  const unsettled: string[] = []

  for (const record of records) {
    const key = ownerKey(record.from, record.chainId)
    const hash = record.hash.toLowerCase()

    byOwner[key] = [...(byOwner[key] ?? []), hash]

    if (isUnsettled(record)) {
      unsettled.push(hash)
    }
  }

  return { version: INDEX_VERSION, byOwner, unsettled }
}
