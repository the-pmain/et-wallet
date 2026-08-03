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

/** Комиссия исходной транзакции. */
const ORIGINAL_MAX_FEE = 30_000_000_000n
const ORIGINAL_PRIORITY_FEE = 2_000_000_000n

/** Данные вызова исходной операции. Ускорение обязано их сохранить. */
const ORIGINAL_DATA =
  '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001' as HexString

class ReplacementNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  balance = 10n ** 20n

  /** Предложение узла. Может быть ниже прежней комиссии транзакции. */
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

let node: ReplacementNode
let repository: TransactionRepository
let service: TransactionService

/** Кладёт в хранилище зависшую транзакцию со всеми параметрами. */
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

describe('Ускорение', () => {
  it('сохраняет номер исходной транзакции', async () => {
    /* В нём весь смысл замены. Взяв следующий свободный номер, кошелёк
       отправил бы вторую транзакцию вдобавок к зависшей. */
    await saveStuck()

    expect((await service.prepareSpeedUp(HASH)).nonce).toBe(7)
  })

  it('повторяет ту же операцию, а не собирает новую', async () => {
    /* Иначе пользователь ждал бы ускорения своего перевода, а получил
       бы под тем же номером неизвестно что. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.to).toBe(RECIPIENT)
    expect(replacement.value).toBe(toWei(10n ** 18n))
    expect(replacement.data).toBe(ORIGINAL_DATA)
    expect(replacement.gasLimit).toBe(60_000n)
  })

  it('поднимает комиссию выше прежней', async () => {
    /* Узел принимает замену только при заметно большей комиссии. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_MAX_FEE)
  })

  it('поднимает обе части комиссии, а не только предельную', async () => {
    /* Узел сравнивает и предельную, и приоритетную: подняв одну,
       замену получить не удастся. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxPriorityFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_PRIORITY_FEE)
  })

  it('надбавка превышает десять процентов', async () => {
    /* Ровно десять даёт при целочисленном округлении значение
       на единицу ниже порога узла, и замена отвергается. */
    await saveStuck()

    const replacement = await service.prepareSpeedUp(HASH)

    expect(replacement.maxFeePerGas ?? 0n).toBeGreaterThan((ORIGINAL_MAX_FEE * 110n) / 100n)
  })

  it('берёт предложение узла, если сеть подорожала сильнее надбавки', async () => {
    /* Иначе ускоренная транзакция зависла бы так же, как исходная. */
    await saveStuck()
    node.feeData = { ...node.feeData, maxFeePerGas: 500_000_000_000n }

    expect((await service.prepareSpeedUp(HASH)).maxFeePerGas).toBe(500_000_000_000n)
  })

  it('отказывает, если параметры исходной транзакции не сохранены', async () => {
    /* Запись сделана версией без их хранения. Догадка означала бы
       отправку другой операции под тем же номером. */
    await saveStuck({ data: null, gasLimit: null })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotReplaceableError)
  })
})

describe('Cancel', () => {
  it('занимает номер переводом самому себе', async () => {
    await saveStuck()

    const cancel = await service.prepareCancel(HASH)

    expect(cancel.nonce).toBe(7)
    expect(cancel.to).toBe(SENDER)
    expect(cancel.value).toBe(toWei(0n))
    expect(cancel.data).toBe('0x')
  })

  it('стоит как простой перевод', async () => {
    await saveStuck()

    expect((await service.prepareCancel(HASH)).gasLimit).toBe(21_000n)
  })

  it('поднимает комиссию выше прежней', async () => {
    await saveStuck()

    expect((await service.prepareCancel(HASH)).maxFeePerGas ?? 0n).toBeGreaterThan(ORIGINAL_MAX_FEE)
  })

  it('доступна и без сохранённых параметров исходной транзакции', async () => {
    /* Отмене они не нужны: она не повторяет операцию, а занимает номер. */
    await saveStuck({ data: null, gasLimit: null })

    await expect(service.prepareCancel(HASH)).resolves.toMatchObject({ nonce: 7 })
  })
})

describe('Замена невозможна', () => {
  it('неизвестная транзакция', async () => {
    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotFoundError)
  })

  it.each([
    ['уже в блоке', TRANSACTION_STATUS.Confirmed],
    ['откачена, но в блоке', TRANSACTION_STATUS.Reverted],
    ['уже замещена', TRANSACTION_STATUS.Replaced],
  ])('%s', async (_name, status: TransactionStatus) => {
    /* Заменить включённую в блок транзакцию нельзя: её номер
       израсходован. Молчаливая отправка «замены» списала бы комиссию
       ни за что. */
    await saveStuck({ status })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(TransactionNotReplaceableError)
    await expect(service.prepareCancel(HASH)).rejects.toThrow(TransactionNotReplaceableError)
  })

  it('причина отказа называется дословно', async () => {
    /* «Ускорить не удалось» без объяснения оставляет владельца наедине
       с зависшим переводом. */
    await saveStuck({ status: TRANSACTION_STATUS.Confirmed })

    await expect(service.prepareSpeedUp(HASH)).rejects.toThrow(/included in a block/i)
  })
})
