import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import { MemoryStorageService, STORAGE_NAMESPACE, toStorageKey } from '@/core/storage'
import { toChainId, type Address, type Timestamp, type TxHash, type Wei } from '@/core/types'
import { FastEncryptionService } from '@/test/doubles'

import { TransactionRepository } from './TransactionRepository'
import { TRANSACTION_STATUS, TRANSACTION_TYPE, type ITransactionRecord } from './types'

const PASSWORD = 'Korova-7-Luna!'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

/** An amount beyond `Number.MAX_SAFE_INTEGER`. */
const LARGE_VALUE = 123_456_789_123_456_789_123n as Wei

let storage: SecureStorage
let repository: TransactionRepository

function record(overrides: Partial<ITransactionRecord> = {}): ITransactionRecord {
  return {
    hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as TxHash,
    chainId: ETHEREUM,
    from: OWNER,
    to: OTHER,
    value: LARGE_VALUE,
    nonce: 7,
    status: TRANSACTION_STATUS.Pending,
    type: TRANSACTION_TYPE.Eip1559,
    submittedAt: 1_700_000_000_000 as Timestamp,
    confirmedAt: null,
    blockNumber: null,
    gasUsed: null,
    effectiveGasPrice: null,
    replacedBy: null,
    confirmations: 0,
    data: null,
    gasLimit: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: null,
    ...overrides,
  }
}

beforeEach(async () => {
  storage = new SecureStorage(new MemoryStorageService(), new FastEncryptionService())
  await storage.initialize(PASSWORD)

  repository = new TransactionRepository(storage)
})

describe('TransactionRepository: persistence', () => {
  it('returns a record without losing precision on large numbers', async () => {
    await repository.save(record())

    const found = await repository.findByHash(record().hash)

    /* Passing through `number` would round the value: 2^53 is less
       than a typical amount in wei. Exact equality is what is checked. */
    expect(found?.value).toBe(LARGE_VALUE)
  })

  it('stores every monetary field as bigint', async () => {
    await repository.save(
      record({
        blockNumber: 18_000_000n,
        gasUsed: 21_000n,
        effectiveGasPrice: 12_345_678_901n,
        confirmedAt: 1_700_000_100_000 as Timestamp,
        status: TRANSACTION_STATUS.Confirmed,
      }),
    )

    const found = await repository.findByHash(record().hash)

    expect(found?.blockNumber).toBe(18_000_000n)
    expect(found?.gasUsed).toBe(21_000n)
    expect(found?.effectiveGasPrice).toBe(12_345_678_901n)
    expect(found?.confirmedAt).toBe(1_700_000_100_000)
  })

  it('restores chainId as bigint', async () => {
    await repository.save(record({ chainId: POLYGON }))

    expect((await repository.findByHash(record().hash))?.chainId).toBe(POLYGON)
  })

  it('overwrites a record with the same hash instead of creating a second', async () => {
    await repository.save(record())
    await repository.save(record({ status: TRANSACTION_STATUS.Confirmed }))

    const all = await repository.findByAddress(OWNER, ETHEREUM)

    expect(all).toHaveLength(1)
    expect(all[0]?.status).toBe(TRANSACTION_STATUS.Confirmed)
  })

  it('stores a contract deployment with an empty recipient', async () => {
    await repository.save(record({ to: null }))

    expect((await repository.findByHash(record().hash))?.to).toBeNull()
  })
})

describe('TransactionRepository: lookup', () => {
  it('returns null for an unknown hash', async () => {
    expect(await repository.findByHash('0xabc' as TxHash)).toBeNull()
  })

  it('selects records by address and network', async () => {
    await repository.save(record())
    await repository.save(
      record({
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as TxHash,
        chainId: POLYGON,
      }),
    )

    expect(await repository.findByAddress(OWNER, ETHEREUM)).toHaveLength(1)
    expect(await repository.findByAddress(OWNER, POLYGON)).toHaveLength(1)
  })

  it('does not confuse addresses written in different case', async () => {
    await repository.save(record())

    const lowercase = OWNER.toLowerCase() as Address

    /* The same address arrives both in EIP-55 checksum and in lowercase
       from RPC replies. A direct string compare would lose the history. */
    expect(await repository.findByAddress(lowercase, ETHEREUM)).toHaveLength(1)
  })

  it('sorts from newest to oldest', async () => {
    await repository.save(record({ submittedAt: 1_000 as Timestamp }))
    await repository.save(
      record({
        hash: '0x3333333333333333333333333333333333333333333333333333333333333333' as TxHash,
        submittedAt: 2_000 as Timestamp,
      }),
    )

    const all = await repository.findByAddress(OWNER, ETHEREUM)

    expect(all[0]?.submittedAt).toBe(2_000)
  })

  it('finds only those awaiting confirmation', async () => {
    await repository.save(record())
    await repository.save(
      record({
        hash: '0x4444444444444444444444444444444444444444444444444444444444444444' as TxHash,
        status: TRANSACTION_STATUS.Confirmed,
      }),
    )

    const pending = await repository.findPending(ETHEREUM)

    expect(pending).toHaveLength(1)
    expect(pending[0]?.status).toBe(TRANSACTION_STATUS.Pending)
  })
})

describe('TransactionRepository: mutation', () => {
  it('updates the record status', async () => {
    await repository.save(record())
    await repository.updateStatus(record().hash, TRANSACTION_STATUS.Reverted)

    expect((await repository.findByHash(record().hash))?.status).toBe(TRANSACTION_STATUS.Reverted)
  })

  it('silently skips an update of an unknown record', async () => {
    await expect(
      repository.updateStatus('0xdead' as TxHash, TRANSACTION_STATUS.Confirmed),
    ).resolves.toBeUndefined()
  })

  it('deletes the address history', async () => {
    await repository.save(record())
    await repository.deleteByAddress(OWNER)

    expect(await repository.findByAddress(OWNER, ETHEREUM)).toHaveLength(0)
  })
})

describe('TransactionRepository: encryption', () => {
  it('does not leave the address in the clear', async () => {
    const plain = new MemoryStorageService()
    const secure = new SecureStorage(plain, new FastEncryptionService())

    await secure.initialize(PASSWORD)
    await new TransactionRepository(secure).save(record())

    const keys = await plain.keys('transactions')
    const stored = await plain.get('transactions', keys[0]!)

    /* The operation list ties the user's addresses together and
       reveals counterparties. A locked wallet must not disclose that. */
    expect(JSON.stringify(stored)).not.toContain(OWNER)
    expect(JSON.stringify(stored)).not.toContain(OTHER)
  })
})

describe('TransactionRepository: index', () => {
  it('a record saved outside the index is still found', async () => {
    /* The index is an accelerator, not the source of truth. Records
       written by an older app version sit in storage without it,
       and they must not be lost. */
    const stored = { ...record(), hash: `0x${'ab'.repeat(32)}` as TxHash }

    await storage.set(
      STORAGE_NAMESPACE.Transactions,
      toStorageKey(`tx.${stored.hash.toLowerCase()}`),
      {
        hash: stored.hash,
        chainId: stored.chainId.toString(),
        from: stored.from,
        to: stored.to,
        value: stored.value.toString(),
        nonce: stored.nonce,
        status: stored.status,
        type: stored.type,
        submittedAt: stored.submittedAt,
        confirmedAt: null,
        blockNumber: null,
        gasUsed: null,
        effectiveGasPrice: null,
        replacedBy: null,
      },
    )

    expect(await repository.findByAddress(stored.from, stored.chainId)).toHaveLength(1)
  })

  it('a corrupted index is rebuilt instead of breaking the read', async () => {
    await repository.save(record())

    /* The format changed or the record is corrupt: the only correct
       answer is to rebuild it by a full read. */
    await storage.set(STORAGE_NAMESPACE.Transactions, toStorageKey('index.v1'), {
      version: 999,
      byOwner: {},
      unsettled: [],
    })

    expect(await repository.findByAddress(record().from, record().chainId)).toHaveLength(1)
  })

  it('the index record itself does not appear in history', async () => {
    /* The index lives in the same namespace and is not a transaction
       record: if it entered the sample it would become a row with
       empty fields. */
    await repository.save(record())

    const history = await repository.findByAddress(record().from, record().chainId)

    expect(history).toHaveLength(1)
    expect(history[0]?.hash).toBe(record().hash)
  })

  it('deleting an address clears it from the index', async () => {
    await repository.save(record())
    await repository.deleteByAddress(record().from)

    expect(await repository.findByAddress(record().from, record().chainId)).toHaveLength(0)
    expect(await repository.findUnsettled(3)).toHaveLength(0)
  })

  it('a deeply confirmed record leaves tracking', async () => {
    /* Otherwise the tracking index would match the whole history,
       and its gain would vanish. */
    await repository.save({
      ...record(),
      status: TRANSACTION_STATUS.Confirmed,
      confirmations: 12,
    })

    expect(await repository.findUnsettled(3)).toHaveLength(0)
  })

  it('a shallowly confirmed one stays under watch', async () => {
    /* The block that holds it can still be displaced by a reorg. */
    await repository.save({
      ...record(),
      status: TRANSACTION_STATUS.Confirmed,
      confirmations: 1,
    })

    expect(await repository.findUnsettled(3)).toHaveLength(1)
  })

  it('a replaced one leaves tracking at once', async () => {
    await repository.save({ ...record(), status: TRANSACTION_STATUS.Replaced })

    expect(await repository.findUnsettled(3)).toHaveLength(0)
  })

  it('a status change removes the record from tracking', async () => {
    const initial = record()

    await repository.save(initial)
    expect(await repository.findUnsettled(3)).toHaveLength(1)

    await repository.save({ ...initial, status: TRANSACTION_STATUS.Confirmed, confirmations: 20 })

    expect(await repository.findUnsettled(3)).toHaveLength(0)
  })

  it('one address history does not contain foreign records', async () => {
    await repository.save(record())
    await repository.save({ ...record(), hash: `0x${'cd'.repeat(32)}` as TxHash, from: OTHER })

    expect(await repository.findByAddress(record().from, record().chainId)).toHaveLength(1)
  })
})
