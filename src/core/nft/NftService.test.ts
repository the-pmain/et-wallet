import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
} from '@/core/history'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type {
  ICallRequest,
  IFeeData,
  ILogEntry,
  IProvider,
  ProviderEventMap,
} from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import { NAME_SELECTOR, SYMBOL_SELECTOR } from '@/core/token'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeProviderFactory, NullLogger } from '@/test/doubles'

import { ERC1155_BALANCE_OF_SELECTOR, OWNER_OF_SELECTOR } from './abi'
import { NftService } from './NftService'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')
const EDITIONS = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Токен ERC-20: то же событие `Transfer`, но три темы вместо четырёх. */
const USDC = toAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')

const LATEST_BLOCK = 20_000n

/** 32-байтовое слово из числа. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Журнальная запись. */
function log(params: { address: Address; topics: readonly string[]; data?: string }): ILogEntry {
  return {
    address: params.address,
    topics: params.topics as readonly HexString[],
    data: (params.data ?? '0x') as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'11'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

/** Поступление предмета ERC-721: четыре темы, номер в теме. */
function incoming721(contract: Address, tokenId: bigint): ILogEntry {
  return log({
    address: contract,
    topics: [TRANSFER_TOPIC, addressToTopic(OTHER), addressToTopic(OWNER), `0x${word(tokenId)}`],
  })
}

/** Поступление ERC-1155: номер и количество в данных. */
function incoming1155(contract: Address, tokenId: bigint, amount: bigint): ILogEntry {
  return log({
    address: contract,
    topics: [
      TRANSFER_SINGLE_TOPIC,
      addressToTopic(OTHER),
      addressToTopic(OTHER),
      addressToTopic(OWNER),
    ],
    data: `0x${word(tokenId)}${word(amount)}`,
  })
}

/** Пакетное поступление ERC-1155: два массива переменной длины. */
function incomingBatch(contract: Address, ids: readonly bigint[]): ILogEntry {
  const idsBody = ids.map((id) => word(id)).join('')
  const amounts = ids.map(() => word(1n)).join('')

  /* Смещения: первый массив после двух слов-смещений, второй — после
     первого вместе с его длиной. */
  const firstOffset = 64n
  const secondOffset = firstOffset + 32n + BigInt(ids.length) * 32n

  return log({
    address: contract,
    topics: [
      TRANSFER_BATCH_TOPIC,
      addressToTopic(OTHER),
      addressToTopic(OTHER),
      addressToTopic(OWNER),
    ],
    data: `0x${word(firstOffset)}${word(secondOffset)}${word(BigInt(ids.length))}${idsBody}${word(BigInt(ids.length))}${amounts}`,
  })
}

class CollectionNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  logs: readonly ILogEntry[] = []

  /** Владельцы предметов ERC-721: ключ — «контракт:номер». */
  owners = new Map<string, Address>()

  /** Остатки ERC-1155: ключ — «контракт:номер». */
  balances = new Map<string, bigint>()

  /** Названия коллекций: ключ — адрес контракта в нижнем регистре. */
  names = new Map<string, string>()

  /** Сколько раз запрашивалось название коллекции. */
  nameCalls = 0

  /** Отказ выборки журналов. */
  logsError: Error | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  getLogs(): Promise<readonly ILogEntry[]> {
    return this.logsError === null ? Promise.resolve(this.logs) : Promise.reject(this.logsError)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(LATEST_BLOCK)
  }

  call(request: ICallRequest): Promise<HexString> {
    const data = request.data ?? '0x'
    const contract = request.to.toLowerCase()

    if (data.startsWith(`0x${OWNER_OF_SELECTOR}`)) {
      const tokenId = BigInt(`0x${data.slice(10)}`)
      const holder = this.owners.get(`${contract}:${tokenId.toString()}`)

      return holder === undefined
        ? Promise.reject(new Error('предмет не существует'))
        : Promise.resolve(`0x${holder.slice(2).toLowerCase().padStart(64, '0')}` as HexString)
    }

    if (data.startsWith(`0x${ERC1155_BALANCE_OF_SELECTOR}`)) {
      const tokenId = BigInt(`0x${data.slice(74)}`)

      return Promise.resolve(
        `0x${word(this.balances.get(`${contract}:${tokenId.toString()}`) ?? 0n)}` as HexString,
      )
    }

    if (data.startsWith(`0x${NAME_SELECTOR}`)) {
      this.nameCalls += 1

      const name = this.names.get(contract)

      return name === undefined
        ? Promise.reject(new Error('функции нет'))
        : Promise.resolve(encodeText(name))
    }

    if (data.startsWith(`0x${SYMBOL_SELECTOR}`)) {
      return Promise.reject(new Error('функции нет'))
    }

    return Promise.reject(new Error('не поддержано'))
  }

  getBalance(): Promise<ReturnType<typeof toWei>> {
    return Promise.resolve(toWei(0n))
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
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
    return Promise.reject(new Error('не поддержано'))
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve({
      baseFeePerGas: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
    })
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('не поддержано'))
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** Строка переменной длины в кодировке ABI. */
function encodeText(value: string): HexString {
  const bytes = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `0x${word(32n)}${word(BigInt(value.length))}${bytes.padEnd(64, '0')}` as HexString
}

let node: CollectionNode
let service: NftService

beforeEach(async () => {
  node = new CollectionNode()

  const networks = new NetworkService({
    repository: new NetworkRepository(new MemoryStorageService()),
    providerFactory: new FakeProviderFactory(),
    logger: new NullLogger(),
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  service = new NftService({
    resolver: { get: () => Promise.resolve(node) },
    networks,
    logger: new NullLogger(),
  })
})

describe('Принадлежность проверяется, а не выводится из журнала', () => {
  it('предмет, оставшийся у владельца, попадает в список', async () => {
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.tokenId).toBe(777n)
  })

  it('предмет, отданный после получения, в список не попадает', async () => {
    /* Журнал показывает историю, а не текущее состояние: поступление
       остаётся в нём навсегда. Показать такой предмет значило бы
       сообщить владельцу об имуществе, которого у него нет. */
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OTHER)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('сожжённый предмет в список не попадает', async () => {
    /* `ownerOf` для него отвечает откатом. Отличить это от недоступности
       узла нечем, и оба случая означают «показывать нельзя». */
    node.logs = [incoming721(PUNKS, 777n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })
})

describe('Различение стандартов', () => {
  it('переводы ERC-20 предметами не считаются', async () => {
    /* У ERC-20 и ERC-721 общее событие `Transfer`; различаются они
       числом индексированных параметров. Считать переводы токенов
       предметами значило бы показать в галерее чужие деньги. */
    node.logs = [
      log({
        address: USDC,
        topics: [TRANSFER_TOPIC, addressToTopic(OTHER), addressToTopic(OWNER)],
        data: `0x${word(1_000_000n)}`,
      }),
    ]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('одиночное поступление ERC-1155 проверяется по остатку', async () => {
    node.logs = [incoming1155(EDITIONS, 5n, 3n)]
    node.balances.set(`${EDITIONS.toLowerCase()}:5`, 2n)

    const page = await service.list(OWNER, CHAIN_ID)

    /* Количество берётся из остатка на момент запроса, а не из события:
       событие описывает тот перевод, а часть тиража могла уйти дальше. */
    expect(page.items[0]?.balance).toBe(2n)
  })

  it('нулевой остаток ERC-1155 исключает предмет', async () => {
    node.logs = [incoming1155(EDITIONS, 5n, 3n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('пакетное поступление разбирается целиком', async () => {
    node.logs = [incomingBatch(EDITIONS, [11n, 12n, 13n])]
    node.balances.set(`${EDITIONS.toLowerCase()}:11`, 1n)
    node.balances.set(`${EDITIONS.toLowerCase()}:13`, 5n)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items.map((item) => item.tokenId)).toEqual([11n, 13n])
  })
})

describe('Повторы и метаданные', () => {
  it('предмет, приходивший дважды, показывается один раз', async () => {
    node.logs = [incoming721(PUNKS, 777n), incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(1)
  })

  it('название коллекции читается из контракта', async () => {
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)
    node.names.set(PUNKS.toLowerCase(), 'CryptoPunks')

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.collectionName).toBe('CryptoPunks')
  })

  it('контракт без названия не получает выдуманного', async () => {
    /* Ни `name`, ни `symbol` не обязательны. Подставить «Неизвестная
       коллекция» значило бы утверждать, что контракт так ответил. */
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.collectionName).toBeNull()
  })

  it('название запрашивается один раз на коллекцию', async () => {
    node.logs = [incoming721(PUNKS, 1n), incoming721(PUNKS, 2n)]
    node.owners.set(`${PUNKS.toLowerCase()}:1`, OWNER)
    node.owners.set(`${PUNKS.toLowerCase()}:2`, OWNER)
    node.names.set(PUNKS.toLowerCase(), 'CryptoPunks')

    await service.list(OWNER, CHAIN_ID)

    expect(node.nameCalls).toBe(1)
  })
})

describe('Границы выборки называются', () => {
  it('глубина просмотра сообщается', async () => {
    expect((await service.list(OWNER, CHAIN_ID)).limits.scannedBlocks).toBe(10_000)
  })

  it('отказ узла не выдаётся за пустую коллекцию', async () => {
    /* Пустой список без объяснения читается владельцем как пропажа
       имущества. */
    node.logsError = new Error('узел не ответил')

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.limits.sourceUnavailable).toBe(true)
    expect(page.limits.reason).toBe('узел не ответил')
  })

  it('непроверенные предметы считаются', async () => {
    /* Число проверок ограничено: каждая — отдельное обращение
       к контракту. Молчаливое обрезание читалось бы как «это всё». */
    node.logs = Array.from({ length: 70 }, (_, index) => incoming721(PUNKS, BigInt(index)))

    for (let index = 0; index < 70; index += 1) {
      node.owners.set(`${PUNKS.toLowerCase()}:${String(index)}`, OWNER)
    }

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(60)
    expect(page.limits.skipped).toBe(10)
  })
})
