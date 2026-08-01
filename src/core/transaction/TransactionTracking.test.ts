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

/** Период опроса, заданный сервисом. */
const TRACKING_INTERVAL_MS = 12_000

/** Узел, состояние которого задаёт проверка. */
class TrackingNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Квитанция. `null` означает «транзакции в блоке нет». */
  receipt: ITransactionReceipt | null = null

  /** Номер последнего блока. Определяет глубину подтверждения. */
  latestBlock = 100n

  /** Сколько транзакций с адреса уже включено в блоки. */
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
    return Promise.reject(new Error('не поддержано'))
  }

  sendRawTransaction(): Promise<TxHash> {
    return Promise.resolve(HASH)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('не поддержано'))
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** Квитанция с заданным исходом выполнения. */
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

/** Кладёт в хранилище ожидающую транзакцию. */
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

/** Дожидается состояния записи в хранилище. */
async function expectStatus(status: TransactionStatus): Promise<ITransactionRecord> {
  return await vi.waitFor(async () => {
    const record = await repository.findByHash(HASH)

    expect(record?.status).toBe(status)

    if (record === null) {
      throw new Error('запись пропала')
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
    repository: new NetworkRepository(storage),
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

describe('Отслеживание: транзакция попала в блок', () => {
  it('успешное выполнение помечается подтверждением', async () => {
    await savePending()
    node.receipt = receiptAt(100n, 'success')

    service.startTracking()

    const record = await expectStatus(TRANSACTION_STATUS.Confirmed)

    expect(record.blockNumber).toBe(100n)
    expect(record.gasUsed).toBe(21_000n)
  })

  it('откат выполнения НЕ показывается как успех', async () => {
    /* Транзакция, включённая в блок, могла завершиться откатом: газ
       списан, операция не выполнена. Показать её успешной значит
       сообщить о переводе, которого не было. */
    await savePending()
    node.receipt = receiptAt(100n, 'reverted')

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Reverted)
  })

  it('считает глубину подтверждения', async () => {
    await savePending()
    node.receipt = receiptAt(98n, 'success')
    node.latestBlock = 100n

    service.startTracking()

    const record = await expectStatus(TRANSACTION_STATUS.Confirmed)

    /* Блок 98 при последнем 100 — три подтверждения: сам блок и два
       поверх него. */
    expect(record.confirmations).toBe(3)
  })

  it('включение в последний блок даёт одно подтверждение', async () => {
    /* Состояние, из которого реорганизация ещё может её вернуть. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')
    node.latestBlock = 100n

    service.startTracking()

    expect((await expectStatus(TRANSACTION_STATUS.Confirmed)).confirmations).toBe(1)
  })

  it('сообщает о смене состояния', async () => {
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

describe('Отслеживание: транзакции в блоке нет', () => {
  it('незанятый nonce означает, что она ещё в мемпуле', async () => {
    await savePending()
    node.receipt = null
    node.confirmedNonce = 7

    service.startTracking()

    /* Проход выполняется, состояние не меняется. */
    await vi.waitFor(async () => {
      expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
    })
  })

  it('израсходованный nonce означает замещение', async () => {
    /* Место транзакции занято другой того же отправителя. Показывать
       её ожидающей значило бы обещать перевод, которого не будет. */
    await savePending()
    node.receipt = null
    node.confirmedNonce = 8

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Replaced)
  })
})

describe('Отслеживание: реорганизация цепи', () => {
  it('исчезнувшая квитанция возвращает запись в ожидание', async () => {
    /* Блок, содержавший транзакцию, вытеснен другим. Оставить запись
       подтверждённой значило бы утверждать состоявшимся то, чего
       в цепи нет. */
    await savePending({
      status: TRANSACTION_STATUS.Pending,
      confirmations: 2,
      blockNumber: 99n,
      confirmedAt: 1_700_000_000_000 as ITransactionRecord['confirmedAt'],
    })

    node.receipt = null
    node.confirmedNonce = 7

    service.startTracking()

    /* Ожидается именно откат глубины: состояние записи и до него
       числилось ожидающим, и проверка по нему прошла бы, ничего
       не проверив. */
    const record = await vi.waitFor(async () => {
      const found = await repository.findByHash(HASH)

      expect(found?.confirmations).toBe(0)

      if (found === null) {
        throw new Error('запись пропала')
      }

      return found
    })

    expect(record.status).toBe(TRANSACTION_STATUS.Pending)
    expect(record.blockNumber).toBeNull()
    expect(record.confirmedAt).toBeNull()
  })
})

describe('Отслеживание: жизненный цикл', () => {
  it('первый проход выполняется сразу, а не через период', async () => {
    /* Приложение могло быть закрыто на час: ждать ещё период опроса,
       чтобы узнать судьбу перевода, незачем. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')

    service.startTracking()

    await expectStatus(TRANSACTION_STATUS.Confirmed)
  })

  it('повторный запуск не создаёт второго таймера', async () => {
    await savePending()

    service.startTracking()
    service.startTracking()

    service.stopTracking()

    /* После остановки опрос прекращается: изменение на узле
       не подхватывается. */
    node.receipt = receiptAt(100n, 'success')
    clock.advance(TRACKING_INTERVAL_MS * 3)

    await Promise.resolve()

    expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
  })

  it('после остановки опрос прекращается', async () => {
    await savePending()

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Pending)

    service.stopTracking()
    node.receipt = receiptAt(100n, 'success')

    clock.advance(TRACKING_INTERVAL_MS * 2)
    await Promise.resolve()

    expect((await repository.findByHash(HASH))?.status).toBe(TRANSACTION_STATUS.Pending)
  })

  it('неглубоко подтверждённая запись продолжает опрашиваться', async () => {
    /* Иначе обработка реорганизации была бы мёртвым кодом:
       подтверждённая запись просто не попадала бы в выборку. */
    await savePending()
    node.receipt = receiptAt(100n, 'success')
    node.latestBlock = 100n

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Confirmed)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(1)
  })

  it('глубоко подтверждённая запись выходит из выборки', async () => {
    await savePending()
    node.receipt = receiptAt(90n, 'success')
    node.latestBlock = 100n

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Confirmed)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(0)
  })

  it('замещённая запись из выборки выходит навсегда', async () => {
    /* Её место занято, и вернуть её в цепь нечем. */
    await savePending()
    node.receipt = null
    node.confirmedNonce = 8

    service.startTracking()
    await expectStatus(TRANSACTION_STATUS.Replaced)

    await expect(repository.findUnsettled(3)).resolves.toHaveLength(0)
  })
})
