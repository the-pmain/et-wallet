import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import type { ILogEntry, ILogFilter, IProvider, ProviderEventMap } from '@/core/provider'
import { toChainId, type ChainId, type HexString, type TxHash } from '@/core/types'

import { LogScanHistoryProvider } from './LogScanHistoryProvider'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
} from './transfer-events'
import { TRANSFER_DIRECTION, TRANSFER_KIND } from './types'

const CHAIN_ID = toChainId(1n)
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const LATEST_BLOCK = 20_000n

/** Слово в 32 байта из числа. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Журнальная запись с заданными темами и данными. */
function log(params: {
  topics: readonly string[]
  data?: string
  logIndex?: number
  removed?: boolean
}): ILogEntry {
  return {
    address: TOKEN,
    topics: params.topics as readonly HexString[],
    data: (params.data ?? '0x') as HexString,
    blockNumber: 19_000n,
    transactionHash: '0xabc' as TxHash,
    logIndex: params.logIndex ?? 0,
    removed: params.removed ?? false,
  }
}

/** Провайдер-дублёр, отдающий заранее заданные журналы. */
class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  logs: readonly ILogEntry[] = []
  failGetLogs = false
  requestedFilters: ILogFilter[] = []

  readonly #events = new EventBus<ProviderEventMap>()

  getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    this.requestedFilters.push(filter)

    if (this.failGetLogs) {
      return Promise.reject(new Error('the range is too wide'))
    }

    /* Дублёр повторяет поведение узла: возвращает только те записи,
       чьи темы совпадают с фильтром по каждой заданной позиции. */
    const topics = filter.topics ?? []

    return Promise.resolve(
      this.logs.filter((entry) =>
        topics.every(
          (topic, index) => topic === null || topic === undefined || entry.topics[index] === topic,
        ),
      ),
    )
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(LATEST_BLOCK)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('не поддержано'))
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getBalance(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  /** Байт-код по адресу. Обычный адрес: проверок контракта в этих тестах нет. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  sendRawTransaction(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let node: StubProvider
let source: LogScanHistoryProvider

const query = { owner: OWNER, chainId: CHAIN_ID, limit: 50 }

beforeEach(() => {
  node = new StubProvider()
  source = new LogScanHistoryProvider()
})

describe('LogScanHistoryProvider: ограничения', () => {
  it('честно сообщает, что нативные переводы недоступны', async () => {
    const page = await source.fetch(query, node)

    /* Перевод нативной валюты не порождает события и в журналах
       отсутствует физически. Умолчать об этом значит утверждать,
       что таких переводов не было. */
    expect(page.limits.nativeTransfersUnavailable).toBe(true)
  })

  it('сообщает глубину просмотренного окна', async () => {
    expect((await source.fetch(query, node)).limits.scannedBlocks).toBe(10_000)
  })

  it('запрашивает окно от текущего блока назад', async () => {
    await source.fetch(query, node)

    expect(node.requestedFilters[0]?.toBlock).toBe(LATEST_BLOCK)
    expect(node.requestedFilters[0]?.fromBlock).toBe(LATEST_BLOCK - 9_999n)
  })

  it('окно содержит ровно объявленное число блоков', async () => {
    /* Вычитание всей глубины давало окно на блок шире объявленного,
       и узлы с пределом ровно в десять тысяч отвечали отказом
       «диапазон слишком широк». Проверено живьём: узел Polygon
       отвергал именно наш запрос, хотя его предел совпадал с нашей
       глубиной. */
    await source.fetch(query, node)

    const filter = node.requestedFilters[0]
    const width = (filter?.toBlock ?? 0n) - (filter?.fromBlock ?? 0n) + 1n

    expect(width).toBe(10_000n)
  })

  it('не уходит ниже нулевого блока в молодой сети', async () => {
    const shallow = new LogScanHistoryProvider({ scanBlocks: 100_000 })

    await shallow.fetch(query, node)

    expect(node.requestedFilters[0]?.fromBlock).toBe(0n)
  })
})

describe('LogScanHistoryProvider: ERC-20', () => {
  beforeEach(() => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${word(1_500_000n)}`,
      }),
    ]
  })

  it('распознаёт перевод токена', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc20)
    expect(transfer?.value).toBe(1_500_000n)
  })

  it('определяет направление относительно владельца', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.direction).toBe(TRANSFER_DIRECTION.Outgoing)
  })

  it('не выдумывает число знаков токена', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    /* Журнал числа знаков не содержит. Подстановка привычных
       восемнадцати исказила бы сумму на порядки. */
    expect(transfer?.asset.decimals).toBeNull()
    expect(transfer?.asset.symbol).toBeNull()
  })

  it('запоминает адрес контракта', async () => {
    expect((await source.fetch(query, node)).transfers[0]?.asset.contract).toBe(TOKEN)
  })
})

describe('LogScanHistoryProvider: ERC-721', () => {
  it('отличает ERC-721 от ERC-20 по числу тем', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER), `0x${word(42n)}`],
      }),
    ]

    const [transfer] = (await source.fetch(query, node)).transfers

    /* Единственный признак: у ERC-721 идентификатор предмета
       индексирован и занимает четвёртую тему. */
    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc721)
    expect(transfer?.tokenId).toBe(42n)
    expect(transfer?.value).toBe(1n)
  })

  it('определяет входящее направление', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER), `0x${word(7n)}`],
      }),
    ]

    expect((await source.fetch(query, node)).transfers[0]?.direction).toBe(
      TRANSFER_DIRECTION.Incoming,
    )
  })
})

describe('LogScanHistoryProvider: ERC-1155', () => {
  it('разбирает перевод одного предмета', async () => {
    node.logs = [
      log({
        topics: [
          TRANSFER_SINGLE_TOPIC,
          addressToTopic(PEER),
          addressToTopic(PEER),
          addressToTopic(OWNER),
        ],
        data: `0x${word(5n)}${word(3n)}`,
      }),
    ]

    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc1155)
    expect(transfer?.tokenId).toBe(5n)
    expect(transfer?.value).toBe(3n)
  })

  it('разбирает набор предметов в одном событии', async () => {
    /* Кодировка ABI: два смещения, длина первого массива, его элементы,
       длина второго массива, его элементы. */
    const data = `0x${word(64n)}${word(160n)}${word(2n)}${word(11n)}${word(12n)}${word(2n)}${word(1n)}${word(2n)}`

    node.logs = [
      log({
        topics: [
          TRANSFER_BATCH_TOPIC,
          addressToTopic(PEER),
          addressToTopic(PEER),
          addressToTopic(OWNER),
        ],
        data,
      }),
    ]

    const { transfers } = await source.fetch(query, node)

    expect(transfers).toHaveLength(2)
    expect(transfers.map((item) => item.tokenId)).toEqual([11n, 12n])
    expect(transfers.map((item) => item.value)).toEqual([1n, 2n])
  })

  it('даёт разным предметам одного события разные идентификаторы', async () => {
    const data = `0x${word(64n)}${word(160n)}${word(2n)}${word(11n)}${word(12n)}${word(2n)}${word(1n)}${word(2n)}`

    node.logs = [
      log({
        topics: [
          TRANSFER_BATCH_TOPIC,
          addressToTopic(PEER),
          addressToTopic(PEER),
          addressToTopic(OWNER),
        ],
        data,
      }),
    ]

    const { transfers } = await source.fetch(query, node)

    /* Ключом служит хэш плюс номер лога плюс номер внутри события:
       одного хэша мало, иначе набор схлопнулся бы в одну запись. */
    expect(new Set(transfers.map((item) => item.id)).size).toBe(2)
  })
})

describe('LogScanHistoryProvider: устойчивость', () => {
  it('отбрасывает записи, отменённые реорганизацией цепи', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${word(1n)}`,
        removed: true,
      }),
    ]

    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })

  it('сообщает об отказе, а не выдаёт его за пустую историю', async () => {
    node.failGetLogs = true

    /* Публичные узлы отвергают выборку журналов без указания контракта —
       именно такую, какая нужна для поиска всех токенов сразу. Проглотив
       отказ, кошелёк утверждал бы, что операций не было. */
    await expect(source.fetch(query, node)).rejects.toThrow(/the range is too wide/)
  })

  it('доводит причину отказа дословно', async () => {
    node.failGetLogs = true

    /* Обобщённое «история недоступна» не подсказывает решения,
       а сообщение узла указывает на него прямо. */
    await expect(source.fetch(query, node)).rejects.toThrow(/range/)
  })

  it('не повторяет перевод, попавший в обе выборки', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(OWNER)],
        data: `0x${word(1n)}`,
      }),
    ]

    const { transfers } = await source.fetch(query, node)

    expect(transfers).toHaveLength(1)
    expect(transfers[0]?.direction).toBe(TRANSFER_DIRECTION.Self)
  })

  it('соблюдает предел числа записей', async () => {
    node.logs = Array.from({ length: 10 }, (_, index) =>
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${word(1n)}`,
        logIndex: index,
      }),
    )

    expect((await source.fetch({ ...query, limit: 4 }, node)).transfers).toHaveLength(4)
  })
})
