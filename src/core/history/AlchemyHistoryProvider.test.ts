import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { ILogEntry, IProvider, IRpcRequest, ProviderEventMap } from '@/core/provider'
import { toChainId, type ChainId, type HexString } from '@/core/types'

import { AlchemyHistoryProvider } from './AlchemyHistoryProvider'
import { TRANSFER_DIRECTION, TRANSFER_KIND } from './types'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Indexer reply for a given query. */
interface IStubResponse {
  readonly sent?: readonly unknown[]
  readonly received?: readonly unknown[]

  /** Next-page keys per query. Absence means the listing is exhausted. */
  readonly sentPageKey?: string
  readonly receivedPageKey?: string
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  response: IStubResponse = {}
  failRequest = false
  requests: IRpcRequest[] = []

  readonly #events = new EventBus<ProviderEventMap>()

  request<TResult>(request: IRpcRequest): Promise<TResult> {
    this.requests.push(request)

    if (this.failRequest) {
      return Promise.reject(new Error('method not supported by the node'))
    }

    const [params] = (request.params ?? []) as readonly Record<string, unknown>[]
    const isSent = params !== undefined && 'fromAddress' in params

    const pageKey = isSent ? this.response.sentPageKey : this.response.receivedPageKey

    return Promise.resolve({
      transfers: (isSent ? this.response.sent : this.response.received) ?? [],
      ...(pageKey === undefined ? {} : { pageKey }),
    } as TResult)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
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

let node: StubProvider
let source: AlchemyHistoryProvider

const query = { owner: OWNER, chainId: CHAIN_ID, limit: 50 }

beforeEach(() => {
  node = new StubProvider()
  source = new AlchemyHistoryProvider()
})

describe('AlchemyHistoryProvider: request', () => {
  it('calls the indexer method', async () => {
    await source.fetch(query, node)

    expect(node.requests[0]?.method).toBe('alchemy_getAssetTransfers')
  })

  it('makes two queries: sent and received', async () => {
    await source.fetch(query, node)

    /* The indexer cannot combine "sender OR recipient", so there
       are exactly two queries. */
    expect(node.requests).toHaveLength(2)
  })

  it('requests all five categories', async () => {
    await source.fetch(query, node)

    const [params] = (node.requests[0]?.params ?? []) as readonly Record<string, unknown>[]

    expect(params?.['category']).toEqual(['external', 'internal', 'erc20', 'erc721', 'erc1155'])
  })

  it('serves built-in networks and rejects unknown ones', () => {
    expect(source.supports(CHAIN_ID)).toBe(true)
    expect(source.supports(BUILT_IN_CHAIN_ID.Polygon)).toBe(true)
    expect(source.supports(toChainId(999_999n))).toBe(false)
  })
})

describe('AlchemyHistoryProvider: amount precision', () => {
  it('takes the amount from the raw field, not the JSON number', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          /* The `value` field is binary floating point: amounts above
             2^53 lose low digits. The implementation must ignore it. */
          value: 1.0000000000000002,
          rawContract: { value: '0xffffffffffffffffffffffff', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.value).toBe(79_228_162_514_264_337_593_543_950_335n)
  })

  it('reads decimals from the reply', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers[0]?.asset.decimals).toBe(6)
  })

  it('leaves decimals unknown when they are missing from the reply', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN },
        },
      ],
    }

    /* Filling in the familiar eighteen decimals would understate a
       six-decimal token by a trillion. */
    expect((await source.fetch(query, node)).transfers[0]?.asset.decimals).toBeNull()
  })
})

describe('AlchemyHistoryProvider: categories', () => {
  it('classifies external and internal transfers as native currency', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'external',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
        },
        {
          uniqueId: 'b',
          hash: '0xhash2',
          category: 'internal',
          from: PEER,
          to: OWNER,
          blockNum: '0x11',
          rawContract: { value: '0x1', address: null, decimal: '0x12' },
        },
      ],
    }

    const kinds = (await source.fetch(query, node)).transfers.map((item) => item.kind)

    /* These two categories are unreachable by log parsing: native
       transfers do not emit events. */
    expect(kinds).toEqual([TRANSFER_KIND.Native, TRANSFER_KIND.Native])
  })

  it('recognises ERC-721 and does not invent an amount', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc721',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          erc721TokenId: '0x2a',
          rawContract: { value: null, address: TOKEN, decimal: null },
        },
      ],
    }

    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc721)
    expect(transfer?.tokenId).toBe(42n)
    expect(transfer?.value).toBe(1n)
  })

  it('expands an ERC-1155 set into separate records', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc1155',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          erc1155Metadata: [
            { tokenId: '0x1', value: '0x2' },
            { tokenId: '0x3', value: '0x4' },
          ],
          rawContract: { value: null, address: TOKEN, decimal: null },
        },
      ],
    }

    const { transfers } = await source.fetch(query, node)

    expect(transfers).toHaveLength(2)
    expect(transfers.map((item) => item.tokenId)).toEqual([1n, 3n])
    expect(new Set(transfers.map((item) => item.id)).size).toBe(2)
  })

  it('drops unknown categories', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'specialnft',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })
})

describe('AlchemyHistoryProvider: untrusted reply', () => {
  it('survives a reply of unexpected shape', async () => {
    node.response = { sent: ['string', 42, null, {}] }

    /* An external service's format can change without notice. One
       corrupt record must not take the user's history away. */
    await expect(source.fetch(query, node)).resolves.toBeDefined()
    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })

  it('skips records that lack required fields', async () => {
    node.response = {
      sent: [
        { uniqueId: 'a', category: 'erc20', from: OWNER },
        {
          uniqueId: 'b',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers).toHaveLength(1)
  })

  it('forwards a node refusal to the caller', async () => {
    node.failRequest = true

    /* The refusal must be visible: a silent empty result would hide
       a broken indexer key. */
    await expect(source.fetch(query, node)).rejects.toThrow()
  })

  it('sets the direction relative to the owner', async () => {
    node.response = {
      received: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: PEER,
          to: OWNER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers[0]?.direction).toBe(
      TRANSFER_DIRECTION.Incoming,
    )
  })

  it('reports that history is not limited', async () => {
    const page = await source.fetch(query, node)

    expect(page.limits.nativeTransfersUnavailable).toBe(false)
    expect(page.limits.scannedBlocks).toBeNull()
  })
})

describe('AlchemyHistoryProvider: continuation', () => {
  it('without page keys there is no continuation', async () => {
    /* The indexer declares the end of the listing, not us by record
       count: the last page may well be full. */
    expect((await source.fetch(query, node)).cursor).toBeNull()
  })

  it('the page key goes back into the request', async () => {
    node.response = { sentPageKey: 'sent-2', receivedPageKey: 'received-2' }

    const first = await source.fetch(query, node)

    node.requests = []

    await source.fetch({ ...query, cursor: first.cursor }, node)

    const keys = node.requests.map(
      (request) => (request.params?.[0] as Record<string, unknown> | undefined)?.['pageKey'],
    )

    expect(keys).toContain('sent-2')
    expect(keys).toContain('received-2')
  })

  it('an exhausted query is not repeated on continuation', async () => {
    /* Sent and received counts differ for an address. Without this
       the shorter side would replay its first page on every "show
       earlier". */
    node.response = { receivedPageKey: 'received-2' }

    const first = await source.fetch(query, node)

    node.requests = []

    await source.fetch({ ...query, cursor: first.cursor }, node)

    expect(node.requests).toHaveLength(1)
    expect((node.requests[0]?.params?.[0] as Record<string, unknown>)['toAddress']).toBe(OWNER)
  })

  it('exhausting both queries closes continuation', async () => {
    node.response = { sentPageKey: 'sent-2' }

    const first = await source.fetch(query, node)

    node.response = {}

    expect((await source.fetch({ ...query, cursor: first.cursor }, node)).cursor).toBeNull()
  })

  it('a foreign cursor is read as the first page', async () => {
    /* A log-scan cursor is a block number; it must not be read as an
       indexer page key. Showing the start again is the worst that is
       allowed. */
    await source.fetch({ ...query, cursor: { providerId: 'logs', value: '19000:10000' } }, node)

    const withKey = node.requests.filter(
      (request) => 'pageKey' in ((request.params?.[0] as Record<string, unknown>) ?? {}),
    )

    expect(node.requests).toHaveLength(2)
    expect(withKey).toHaveLength(0)
  })
})
