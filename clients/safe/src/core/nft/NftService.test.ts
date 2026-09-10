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
import { NAME_SELECTOR, SYMBOL_SELECTOR } from '@/core/token'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeProviderFactory, NullLogger, createSecureMemoryStorage } from '@/test/doubles'

import { ERC1155_BALANCE_OF_SELECTOR, OWNER_OF_SELECTOR } from './abi'
import { NftService } from './NftService'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')
const EDITIONS = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** An ERC-20 token: the same `Transfer` event, but three topics instead of four. */
const USDC = toAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')

const LATEST_BLOCK = 20_000n

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

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

/** An incoming ERC-721 item: four topics, the id in a topic. */
function incoming721(contract: Address, tokenId: bigint): ILogEntry {
  return log({
    address: contract,
    topics: [TRANSFER_TOPIC, addressToTopic(OTHER), addressToTopic(OWNER), `0x${word(tokenId)}`],
  })
}

/** An incoming ERC-1155: id and amount in the data. */
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

/** A batched ERC-1155 receipt: two variable-length arrays. */
function incomingBatch(contract: Address, ids: readonly bigint[]): ILogEntry {
  const idsBody = ids.map((id) => word(id)).join('')
  const amounts = ids.map(() => word(1n)).join('')

  /* Offsets: the first array after two offset words, the second after
     the first including its length. */
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

  /** ERC-721 item owners: key is "contract:id". */
  owners = new Map<string, Address>()

  /** ERC-1155 balances: key is "contract:id". */
  balances = new Map<string, bigint>()

  /** Collection names: key is the contract address in lowercase. */
  names = new Map<string, string>()

  /** How many times the collection name was requested. */
  nameCalls = 0

  /** Refusal of the log query. */
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
        ? Promise.reject(new Error('item does not exist'))
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
        ? Promise.reject(new Error('function is missing'))
        : Promise.resolve(encodeText(name))
    }

    if (data.startsWith(`0x${SYMBOL_SELECTOR}`)) {
      return Promise.reject(new Error('function is missing'))
    }

    return Promise.reject(new Error('not supported'))
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
    return Promise.reject(new Error('not supported'))
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
    return Promise.reject(new Error('not supported'))
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

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
    repository: new NetworkRepository(await createSecureMemoryStorage()),
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

describe('Ownership is checked, not inferred from the log', () => {
  it('an item still held by the owner appears in the list', async () => {
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.tokenId).toBe(777n)
  })

  it('an item given away after receipt does not appear', async () => {
    /* The log shows history, not current state: a receipt stays in
       it forever. Showing such an item would tell the owner they
       hold property they do not have. */
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OTHER)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('a burned item does not appear', async () => {
    /* `ownerOf` answers it with a revert. There is no way to tell
       this from a node outage, and both cases mean "must not show". */
    node.logs = [incoming721(PUNKS, 777n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })
})

describe('Distinguishing standards', () => {
  it('ERC-20 transfers are not treated as items', async () => {
    /* ERC-20 and ERC-721 share the `Transfer` event; they differ by
       the number of indexed parameters. Treating token transfers as
       items would show someone else's money in the gallery. */
    node.logs = [
      log({
        address: USDC,
        topics: [TRANSFER_TOPIC, addressToTopic(OTHER), addressToTopic(OWNER)],
        data: `0x${word(1_000_000n)}`,
      }),
    ]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('a single ERC-1155 receipt is checked against the balance', async () => {
    node.logs = [incoming1155(EDITIONS, 5n, 3n)]
    node.balances.set(`${EDITIONS.toLowerCase()}:5`, 2n)

    const page = await service.list(OWNER, CHAIN_ID)

    /* The amount is taken from the balance at query time, not from
       the event: the event describes that transfer, and part of the
       supply may have moved on. */
    expect(page.items[0]?.balance).toBe(2n)
  })

  it('a zero ERC-1155 balance excludes the item', async () => {
    node.logs = [incoming1155(EDITIONS, 5n, 3n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('a batch receipt is parsed in full', async () => {
    node.logs = [incomingBatch(EDITIONS, [11n, 12n, 13n])]
    node.balances.set(`${EDITIONS.toLowerCase()}:11`, 1n)
    node.balances.set(`${EDITIONS.toLowerCase()}:13`, 5n)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items.map((item) => item.tokenId)).toEqual([11n, 13n])
  })
})

describe('Duplicates and metadata', () => {
  it('an item that arrived twice is shown once', async () => {
    node.logs = [incoming721(PUNKS, 777n), incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(1)
  })

  it('the collection name is read from the contract', async () => {
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)
    node.names.set(PUNKS.toLowerCase(), 'CryptoPunks')

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.collectionName).toBe('CryptoPunks')
  })

  it('a contract without a name is not given a made-up one', async () => {
    /* Neither `name` nor `symbol` is required. Filling in "Unknown
       collection" would claim the contract answered that way. */
    node.logs = [incoming721(PUNKS, 777n)]
    node.owners.set(`${PUNKS.toLowerCase()}:777`, OWNER)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.collectionName).toBeNull()
  })

  it('the name is requested once per collection', async () => {
    node.logs = [incoming721(PUNKS, 1n), incoming721(PUNKS, 2n)]
    node.owners.set(`${PUNKS.toLowerCase()}:1`, OWNER)
    node.owners.set(`${PUNKS.toLowerCase()}:2`, OWNER)
    node.names.set(PUNKS.toLowerCase(), 'CryptoPunks')

    await service.list(OWNER, CHAIN_ID)

    expect(node.nameCalls).toBe(1)
  })
})

describe('Scan limits are named', () => {
  it('the scan depth is reported', async () => {
    expect((await service.list(OWNER, CHAIN_ID)).limits.scannedBlocks).toBe(10_000)
  })

  it('a node refusal is not treated as an empty collection', async () => {
    /* An empty list with no explanation is read by the owner as
       missing property. */
    node.logsError = new Error('the node did not respond')

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.limits.sourceUnavailable).toBe(true)
    expect(page.limits.reason).toBe('the node did not respond')
  })

  it('unchecked items are counted', async () => {
    /* The number of checks is capped: each is a separate call to the
       contract. A silent trim would be read as "this is all". */
    node.logs = Array.from({ length: 70 }, (_, index) => incoming721(PUNKS, BigInt(index)))

    for (let index = 0; index < 70; index += 1) {
      node.owners.set(`${PUNKS.toLowerCase()}:${String(index)}`, OWNER)
    }

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(60)
    expect(page.limits.skipped).toBe(10)
  })
})
