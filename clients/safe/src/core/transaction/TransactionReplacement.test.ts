import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import { TransactionNotFoundError, TransactionNotReplaceableError } from '@/core/errors'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import { toWei, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeClock, FakeProviderFactory, FastEncryptionService, NullLogger } from '@/test/doubles'

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

const ORIGINAL_MAX_FEE = 30_000_000_000n
const ORIGINAL_PRIORITY_FEE = 2_000_000_000n

/** Call data of the original operation. A speed-up must keep it. */
const ORIGINAL_DATA =
  '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001' as HexString

class ReplacementNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  balance = 10n ** 20n

  /** The node's quote. It may be lower than the original fee. */
  feeData: IFeeData = {
    baseFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    gasPrice: 2_000_000_000n,
  }

  readonly #events = new EventBus<ProviderEventMap>()

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve(this.feeData)
  }

  getBalance(): Promise<ReturnType<typeof toWei>> {
    return Promise.resolve(toWei(this.balance))
  }

  getNonce(): Promise<number> {
    return Promise.resolve(9)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(9)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(100n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
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

let node: ReplacementNode
let repository: TransactionRepository
let service: TransactionService

/** Puts a stuck transaction with all parameters into storage. */
async function saveStuck(overrides: Partial<ITransactionRecord> = {}): Promise<void> {
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
    data: ORIGINAL_DATA,
    gasLimit: 60_000n,
    maxFeePerGas: ORIGINAL_MAX_FEE,
    maxPriorityFeePerGas: ORIGINAL_PRIORITY_FEE,
    gasPrice: null,
    ...overrides,
  })
}

beforeEach(async () => {
  node = new ReplacementNode()

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
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
})

describe('Speed-up', () => {
  it('keeps the original transaction nonce', async () => {
    /* The replacement's whole point is this nonce. Taking the next
       free number would send a second transaction on top of the stuck
       one. */
    await saveStuck()

    expect((await service.prepareSpeedUp(HASH)).nonce).toBe(7)
  })

  it('repeats the same operation, rather than building a new one', async () => {
    /* Otherwise the user would wait for their transfer to speed up
       and receive something unknown under the same nonce. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.to).toBe(RECIPIENT)
    expect(replacement.value).toBe(toWei(10n ** 18n))
    expect(replacement.data).toBe(ORIGINAL_DATA)
    expect(replacement.gasLimit).toBe(60_000n)
  })

  it('raises the fee above the original', async () => {
    /* The node accepts a replacement only at a noticeably higher fee. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_MAX_FEE)
  })

  it('raises both fee parts, not only the cap', async () => {
    /* The node compares both the cap and the tip: raising only one
       will not get the replacement accepted. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxPriorityFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_PRIORITY_FEE)
  })

  it('the bump exceeds ten percent', async () => {
    /* Exactly ten, after integer rounding, yields a value one below
       the node's threshold, and the replacement is rejected. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxFeePerGas ?? 0n).toBeGreaterThan((ORIGINAL_MAX_FEE * 110n) / 100n)
  })

  it('takes the node quote when the network rose more than the bump', async () => {
    /* Otherwise the sped-up transaction would stall the same way as
       the original. */
    await saveStuck()
    node.feeData = { ...node.feeData, maxFeePerGas: 500_000_000_000n }

    expect((await service.prepareSpeedUp(HASH)).maxFeePerGas).toBe(500_000_000_000n)
  })

  it('refuses when the original transaction parameters were not saved', async () => {
    /* The record was written by a version that did not store them.
       Guessing would mean sending a different operation under the
       same nonce. */
    await saveStuck({ data: null, gasLimit: null })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotReplaceableError)
  })
})

describe('Cancel', () => {
  it('occupies the nonce with a transfer to oneself', async () => {
    await saveStuck()

    const cancel = await service.prepareCancel(HASH)

    expect(cancel.nonce).toBe(7)
    expect(cancel.to).toBe(SENDER)
    expect(cancel.value).toBe(toWei(0n))
    expect(cancel.data).toBe('0x')
  })

  it('costs as a simple transfer', async () => {
    await saveStuck()

    expect((await service.prepareCancel(HASH)).gasLimit).toBe(21_000n)
  })

  it('raises the fee above the original', async () => {
    await saveStuck()

    expect((await service.prepareCancel(HASH)).maxFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_MAX_FEE)
  })

  it('is available even without saved original parameters', async () => {
    /* Cancel does not need them: it does not repeat the operation,
       it occupies the nonce. */
    await saveStuck({ data: null, gasLimit: null })

    await expect(service.prepareCancel(HASH)).resolves.toMatchObject({ nonce: 7 })
  })
})

describe('Replacement is impossible', () => {
  it('an unknown transaction', async () => {
    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotFoundError)
  })

  it.each([
    ['already in a block', TRANSACTION_STATUS.Confirmed],
    ['reverted, but in a block', TRANSACTION_STATUS.Reverted],
    ['already replaced', TRANSACTION_STATUS.Replaced],
  ])('%s', async (_name, status: TransactionStatus) => {
    /* A transaction already in a block cannot be replaced: its nonce
       is spent. Silently sending a "replacement" would charge a fee
       for nothing. */
    await saveStuck({ status })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotReplaceableError)
    await expect(service.prepareCancel(HASH)).rejects.toThrow(TransactionNotReplaceableError)
  })

  it('the refusal reason is named verbatim', async () => {
    /* "Speed-up failed" with no explanation leaves the owner alone
       with a stuck transfer. */
    await saveStuck({ status: TRANSACTION_STATUS.Confirmed })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(/included in a block/i)
  })
})
