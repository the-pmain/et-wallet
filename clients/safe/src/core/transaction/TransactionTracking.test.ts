import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type { ILogEntry, IProvider, ITransactionReceipt, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import { toWei, type BlockHash, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeClock, FastEncryptionService, FakeProviderFactory, NullLogger } from '@/test/doubles'

import { TransactionRepository } from './TransactionRepository'
import { TransactionService } from './TransactionService'
import {
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type ITransactionRecord,
  type TransactionStatus,
} from './types'

const PASSWORD = 'Korova-7-Luna!'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as TxHash

const TRACKING_INTERVAL_MS = 12_000

/** A node whose state the check sets. */
class TrackingNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Receipt. `null` means the transaction is not in a block. */
  receipt: ITransactionReceipt | null = null

  /** Latest block number. Determines confirmation depth. */
  latestBlock = 100n

  /** How many transactions from the address are already in blocks. */
  confirmedNonce = 7

  readonly #events = new EventBus<ProviderEventMap>()

  getTransactionReceipt(): Promise<ITransactionReceipt | null> {
    return Promise.resolve(this.receipt)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.latestBlock)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(this.confirmedNonce)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(this.confirmedNonce)
  }

  getBalance(): Promise<ReturnType<typeof toWei>> {
    return Promise.resolve(toWei(0n))
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  sendRawTransaction(): Promise<TxHash> {
    return Promise.resolve(HASH)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** A receipt with a given execution outcome. */
function receiptAt(blockNumber: bigint, status: 'success' | 'reverted'): ITransactionReceipt {
  return {
    transactionHash: HASH,
    blockNumber,
    blockHash: `0x${'ab'.repeat(32)}` as BlockHash,
    from: SENDER,
    to: RECIPIENT,
    status,
    gasUsed: 21_000n,
    effectiveGasPrice: 25_000_000_000n,
    contractAddress: null,
    logs: [],
  }
}

let node: TrackingNode
let clock: FakeClock
let repository: TransactionRepository
let service: TransactionService

/** Puts a pending transaction into storage. */
async function savePending(overrides: Partial<ITransactionRecord> = {}): Promise<void> {
  await repository.save({
    hash: HASH,
    chainId: CHAIN_ID,
    from: SENDER,
    to: RECIPIENT,
    value: toWei(10n ** 18n),
    nonce: 7,
    status: TRANSACTION_STATUS.Pending,
    type: TRANSACTION_TYPE.Eip1559,
    submittedAt: 1_700_000_000_000 as ITransactionRecord['submittedAt'],
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
  })
}

/** Waits until the record in storage has the given status. */
async function expectStatus(status: TransactionStatus): Promise<ITransactionRecord> {
  return await vi.waitFor(async () => {
    const record = await repository.findByHash(HASH)

    expect(record?.status).toBe(status)

    if (record === null) {
      throw new Error('the record disappeared')
    }

    return record
  })
}

beforeEach(async () => {
  node = new TrackingNode()
  clock = new FakeClock(1_700_000_000_000)

  const storage = new MemoryStorageService()
  const secure = new SecureStorage(storage, new FastEncryptionService())

  await secure.initialize(PASSWORD)

  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(secure),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  repository = new TransactionRepository(secure)
  service = new TransactionService({
    resolver: { get: () => Promise.resolve(node) },
    networks,
    repository,
    clock,
    logger,
  })
})

describe('Tracking: the transaction landed in a block', () => {
  it('successful execution is marked as confirmed', async () => {
    await savePending()
    node.receipt = receiptAt(100n, 'success')

    service.startTracking()

    const record = await expectStatus(TRANSACTION_STATUS.Confirmed)

    expect(record.blockNumber).toBe(100n)
    expect(record.gasUsed).toBe(21_000n)
  })

  it('an execution revert is NOT shown as success', async () => {
    /* A transaction included in a block may have reverted: gas is
       charged, the operation is not done. Showing it as successful
       would report a transfer that never happened. */
    await savePending()
    node.receipt = receiptAt(100n, 'reverted')

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Reverted)
  })

  it('counts the confirmation depth', async () => {
    await savePending()
    node.receipt = receiptAt(98n, 'success')
    node.latestBlock = 100n

    service.startTracking()

    const record = await expectStatus(TRANSACTION_STATUS.Confirmed)

    /* Block 98 with latest 100 is three confirmations: the block
       itself and two on top of it. */
    expect(record.confirmations).toBe(3)
  })

  it('inclusion in the latest block yields one confirmation', async () => {
    /* A state from which a reorg can still take it back. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')
    node.latestBlock = 100n

    service.startTracking()

    expect((await expectStatus(TRANSACTION_STATUS.Confirmed)).confirmations).toBe(1)
  })

  it('announces a status change', async () => {
    const seen: TransactionStatus[] = []

    service.on('transaction:statusChanged', ({ status }) => {
      seen.push(status)
    })

    await savePending()
    node.receipt = receiptAt(100n, 'success')

    service.startTracking()

    await vi.waitFor(() => {
      expect(seen).toContain(TRANSACTION_STATUS.Confirmed)
    })
  })
})

describe('Tracking: the transaction is not in a block', () => {
  it('an unused nonce means it is still in the mempool', async () => {
    await savePending()
    node.receipt = null
    node.confirmedNonce = 7

    service.startTracking()

    await vi.waitFor(async () => {
      expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
    })
  })

  it('a spent nonce means replacement', async () => {
    /* The transaction's slot is taken by another from the same
       sender. Showing it as pending would promise a transfer that
       will not happen. */
    await savePending()
    node.receipt = null
    node.confirmedNonce = 8

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Replaced)
  })
})

describe('Tracking: chain reorganisation', () => {
  it('a vanished receipt returns the record to pending', async () => {
    /* The block that held the transaction was displaced by another.
       Leaving the record confirmed would claim as done something
       that is not on the chain. */
    await savePending({
      status: TRANSACTION_STATUS.Pending,
      confirmations: 2,
      blockNumber: 99n,
      confirmedAt: 1_700_000_000_000 as ITransactionRecord['confirmedAt'],
    })

    node.receipt = null
    node.confirmedNonce = 7

    service.startTracking()

    /* The depth rollback is what is awaited: the record status was
       already pending, and a check against it would pass without
       checking anything. */
    const record = await vi.waitFor(async () => {
      const found = await repository.findByHash(HASH)

      expect(found?.confirmations).toBe(0)

      if (found === null) {
        throw new Error('the record disappeared')
      }

      return found
    })

    expect(record.status).toBe(TRANSACTION_STATUS.Pending)
    expect(record.blockNumber).toBeNull()
    expect(record.confirmedAt).toBeNull()
  })
})

describe('Tracking: lifecycle', () => {
  it('the first pass runs immediately, not after the interval', async () => {
    /* The app may have been closed for an hour: waiting another
       poll interval to learn the transfer's fate is pointless. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Confirmed)
  })

  it('a second start does not create a second timer', async () => {
    await savePending()

    service.startTracking()
    service.startTracking()

    service.stopTracking()

    /* After a halt, polling stops: a change on the node is not
       picked up. */
    node.receipt = receiptAt(100n, 'success')
    clock.advance(TRACKING_INTERVAL_MS * 3)

    await Promise.resolve()

    expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
  })

  it('polling stops after a halt', async () => {
    await savePending()

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Pending)

    service.stopTracking()
    node.receipt = receiptAt(100n, 'success')

    clock.advance(TRACKING_INTERVAL_MS * 2)
    await Promise.resolve()

    expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
  })

  it('a shallowly confirmed record keeps being polled', async () => {
    /* Otherwise reorg handling would be dead code: a confirmed
       record would simply never enter the sample. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')
    node.latestBlock = 100n

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Confirmed)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(1)
  })

  it('a deeply confirmed record leaves the sample', async () => {
    await savePending()
    node.receipt = receiptAt(90n, 'success')
    node.latestBlock = 100n

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Confirmed)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(0)
  })

  it('a replaced record leaves the sample for good', async () => {
    /* Its slot is taken, and there is no way to put it back on chain. */
    await savePending()
    node.receipt = null
    node.confirmedNonce = 8

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Replaced)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(0)
  })
})
