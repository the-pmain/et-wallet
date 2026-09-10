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

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

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

/** A provider stand-in that returns pre-set logs. */
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

    /* The stand-in repeats node behaviour: it returns only entries
       whose topics match the filter at each given position. */
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
    return Promise.reject(new Error('not supported'))
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getBalance(): Promise<never> {
    return Promise.reject(new Error('not supported'))
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

  /** Bytecode at the address. An ordinary address: these tests do not check for a contract. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  sendRawTransaction(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
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

describe('LogScanHistoryProvider: limits', () => {
  it('honestly reports that native transfers are unavailable', async () => {
    const page = await source.fetch(query, node)

    /* A native transfer emits no event and is physically absent from
       the logs. Staying silent would claim that no such transfers
       happened. */
    expect(page.limits.nativeTransfersUnavailable).toBe(true)
  })

  it('reports the depth of the scanned window', async () => {
    expect((await source.fetch(query, node)).limits.scannedBlocks).toBe(10_000)
  })

  it('requests a window backward from the current block', async () => {
    await source.fetch(query, node)

    expect(node.requestedFilters[0]?.toBlock).toBe(LATEST_BLOCK)
    expect(node.requestedFilters[0]?.fromBlock).toBe(LATEST_BLOCK - 9_999n)
  })

  it('the window contains exactly the declared number of blocks', async () => {
    /* Subtracting the full depth made the window one block wider
       than declared, and nodes with a limit of exactly ten thousand
       answered "range too wide". Checked live: a Polygon node
       rejected our request even though its limit matched our depth. */
    await source.fetch(query, node)

    const filter = node.requestedFilters[0]
    const width = (filter?.toBlock ?? 0n) - (filter?.fromBlock ?? 0n) + 1n

    expect(width).toBe(10_000n)
  })

  it('does not go below the zero block on a young network', async () => {
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

  it('recognises a token transfer', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc20)
    expect(transfer?.value).toBe(1_500_000n)
  })

  it('sets the direction relative to the owner', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.direction).toBe(TRANSFER_DIRECTION.Outgoing)
  })

  it('does not invent the token decimals', async () => {
    const [transfer] = (await source.fetch(query, node)).transfers

    /* The log does not contain decimals. Filling in the familiar
       eighteen would distort the amount by orders of magnitude. */
    expect(transfer?.asset.decimals).toBeNull()
    expect(transfer?.asset.symbol).toBeNull()
  })

  it('remembers the contract address', async () => {
    expect((await source.fetch(query, node)).transfers[0]?.asset.contract).toBe(TOKEN)
  })
})

describe('LogScanHistoryProvider: ERC-721', () => {
  it('distinguishes ERC-721 from ERC-20 by the topic count', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER), `0x${word(42n)}`],
      }),
    ]

    const [transfer] = (await source.fetch(query, node)).transfers

    /* The only signal: for ERC-721 the item id is indexed and
       occupies the fourth topic. */
    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc721)
    expect(transfer?.tokenId).toBe(42n)
    expect(transfer?.value).toBe(1n)
  })

  it('sets the incoming direction', async () => {
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
  it('parses a single-item transfer', async () => {
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

  it('parses a set of items in one event', async () => {
    /* ABI encoding: two offsets, length of the first array, its
       items, length of the second array, its items. */
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

  it('gives different items of one event different identifiers', async () => {
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

    /* The key is the hash plus the log index plus the index inside
       the event: the hash alone is not enough, or the set would
       collapse into one record. */
    expect(new Set(transfers.map((item) => item.id)).size).toBe(2)
  })
})

describe('LogScanHistoryProvider: resilience', () => {
  it('drops records cancelled by a chain reorganisation', async () => {
    node.logs = [
      log({
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${word(1n)}`,
        removed: true,
      }),
    ]

    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })

  it('reports a refusal instead of treating it as empty history', async () => {
    node.failGetLogs = true

    /* Public nodes reject a log query with no contract — exactly the
       query needed to find every token at once. Swallowing the
       refusal, the wallet would claim that no operations happened. */
    await expect(source.fetch(query, node)).rejects.toThrow(/the range is too wide/)
  })

  it('forwards the refusal reason verbatim', async () => {
    node.failGetLogs = true

    /* A generic "history unavailable" does not hint at a fix, while
       the node's message points to it directly. */
    await expect(source.fetch(query, node)).rejects.toThrow(/range/)
  })

  it('does not repeat a transfer that landed in both queries', async () => {
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

  it('respects the record-count limit', async () => {
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

describe('LogScanHistoryProvider: continuing the scan', () => {
  it('the first page promises a continuation', async () => {
    /* Log parsing covers only a window of blocks. The continuation
       cursor is the only thing that distinguishes "this is all of
       history" from "this is its top end", and without it an empty
       list would be read as no operations ever. */
    expect((await source.fetch(query, node)).cursor).not.toBeNull()
  })

  it('the second page scans the window immediately before the first', async () => {
    /* A gap between windows would lose operations silently, an
       overlap would show them twice. The bounds must meet. */
    const first = await source.fetch(query, node)

    node.requestedFilters = []

    await source.fetch({ ...query, cursor: first.cursor }, node)

    const firstWindowStart = LATEST_BLOCK - 9_999n

    expect(node.requestedFilters[0]?.toBlock).toBe(firstWindowStart - 1n)
    expect(node.requestedFilters[0]?.fromBlock).toBe(firstWindowStart - 10_000n)
  })

  it('after a cursor the node is not asked for the latest block', async () => {
    /* The network moves on between pages. If continuation took a
       fresh latest block, the window would shift and a gap the size
       of the grown chain would open between pages. */
    const first = await source.fetch(query, node)
    let asked = 0

    node.getBlockNumber = () => {
      asked += 1

      return Promise.resolve(LATEST_BLOCK + 5_000n)
    }

    await source.fetch({ ...query, cursor: first.cursor }, node)

    expect(asked).toBe(0)
  })

  it('scan depth is summed across pages', async () => {
    /* The label "ten thousand blocks scanned" after the third press
       would be wrong by a factor of three. */
    const first = await source.fetch(query, node)
    const second = await source.fetch({ ...query, cursor: first.cursor }, node)

    expect(second.limits.scannedBlocks).toBe(20_000)
  })

  it('there is no continuation at the start of the chain', async () => {
    /* The zero block is the floor of history. A cursor here would
       mean the "show earlier" button never disappears. */
    node.getBlockNumber = () => Promise.resolve(5_000n)

    const page = await source.fetch(query, node)

    expect(page.cursor).toBeNull()
    expect(page.limits.scannedBlocks).toBe(5_001)
  })

  it('a foreign cursor restarts the scan instead of breaking the listing', async () => {
    /* Another source issued the cursor: reading it as a block number
       would walk into an unknown part of the chain. Showing the
       start again is the worst that is allowed. */
    const page = await source.fetch(
      { ...query, cursor: { providerId: 'alchemy', value: '{"sent":"key"}' } },
      node,
    )

    expect(page.limits.scannedBlocks).toBe(10_000)
  })
})
