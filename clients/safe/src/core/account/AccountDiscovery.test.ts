import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { NullLogger } from '@/test/doubles'

import { DEFAULT_GAP_LIMIT, MAX_SCANNED_ADDRESSES, discoverUsedAccounts } from './AccountDiscovery'

/** Address by number: the value does not matter, distinguishability does. */
function addressAt(index: number): Address {
  return toAddress(`0x${index.toString(16).padStart(40, '0')}`)
}

/**
 * A node with occupied addresses set.
 *
 * Occupancy is set separately by count and by balance: an address
 * that only received has a zero count, an emptied one has a zero
 * balance, and both must be found.
 */
class DiscoveryNode implements IProvider {
  readonly chainId = 1n as ChainId
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Indexes of addresses that have sent. */
  sent = new Set<number>()

  /** Indexes of addresses that hold funds. */
  funded = new Set<number>()

  /** Node refusal. Stops the search, does not skip the address. */
  failure: Error | null = null

  /** How many addresses were queried. */
  queried = 0

  readonly #events = new EventBus<ProviderEventMap>()

  #indexOf(address: Address): number {
    return Number.parseInt(address.slice(2), 16)
  }

  getTransactionCount(address: Address): Promise<number> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }

    this.queried += 1

    return Promise.resolve(this.sent.has(this.#indexOf(address)) ? 3 : 0)
  }

  getBalance(address: Address): Promise<ReturnType<typeof toWei>> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }

    return Promise.resolve(toWei(this.funded.has(this.#indexOf(address)) ? 10n ** 18n : 0n))
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.chainId)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
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

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
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

const logger = new NullLogger()

describe('Signs of a used address', () => {
  it('an address with sent transactions is found', async () => {
    const node = new DiscoveryNode()

    node.sent.add(0)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0])
  })

  it('an address with a balance is found even if it never sent', async () => {
    /* Only received: its transaction count is zero, and by that
       sign alone it would be lost. */
    const node = new DiscoveryNode()

    node.funded.add(0)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0])
  })

  it('an emptied address is found by the count', async () => {
    /* Everything was withdrawn: the balance is zero, but the
       address was used, and it must not be lost — a token or item
       may sit on it. */
    const node = new DiscoveryNode()

    node.sent.add(2)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([2])
  })

  it('an empty wallet yields an empty list', async () => {
    expect(
      (await discoverUsedAccounts(new DiscoveryNode(), addressAt, logger)).usedIndexes,
    ).toEqual([])
  })
})

describe('Gap of empty addresses', () => {
  it('the search does not stop at the first empty one', async () => {
    /* Wallets skip addresses at creation: stopping at the first
       empty one would lose everything after it. */
    const node = new DiscoveryNode()

    node.sent.add(0)
    node.funded.add(5)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0, 5])
  })

  it('finds an address on the gap boundary', async () => {
    const node = new DiscoveryNode()

    node.sent.add(DEFAULT_GAP_LIMIT - 1)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([
      DEFAULT_GAP_LIMIT - 1,
    ])
  })

  it('does not search past the gap', async () => {
    /* BIP-44 rule: twenty empty in a row mean the end. Searching
       further would mean querying the node without a limit. */
    const node = new DiscoveryNode()

    node.sent.add(DEFAULT_GAP_LIMIT + 5)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([])
  })

  it('the gap is counted again after a find', async () => {
    const node = new DiscoveryNode()

    node.sent.add(0)
    node.sent.add(DEFAULT_GAP_LIMIT)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([
      0,
      DEFAULT_GAP_LIMIT,
    ])
  })

  it('an empty wallet is queried exactly to the gap depth', async () => {
    const node = new DiscoveryNode()

    const result = await discoverUsedAccounts(node, addressAt, logger)

    expect(result.scanned).toBe(DEFAULT_GAP_LIMIT)
    expect(node.queried).toBe(DEFAULT_GAP_LIMIT)
  })
})

describe('Limits and refusals', () => {
  it('the search is capped from above', async () => {
    /* A node that reports activity on every address must not take
       the search to infinity. */
    const node = new DiscoveryNode()

    for (let index = 0; index < 500; index += 1) {
      node.sent.add(index)
    }

    const result = await discoverUsedAccounts(node, addressAt, logger, { maxScanned: 30 })

    expect(result.scanned).toBe(30)
    expect(result.stoppedByLimit).toBe(true)
  })

  it('a stop by gap is not counted as the cap', async () => {
    /* The difference matters to the UI: in one case “that is
       all”, in the other — “more may remain further on”. */
    expect(
      (await discoverUsedAccounts(new DiscoveryNode(), addressAt, logger)).stoppedByLimit,
    ).toBe(false)
  })

  it('a node refusal stops the search and returns what was found', async () => {
    /* Skipping an address would silently lose an account — exactly
       what this whole search is written against. */
    const node = new DiscoveryNode()

    node.sent.add(0)

    const first = await discoverUsedAccounts(node, addressAt, logger)

    node.failure = new Error('the node did not answer')

    const second = await discoverUsedAccounts(node, addressAt, logger)

    expect(first.usedIndexes).toEqual([0])
    expect(second.usedIndexes).toEqual([])
    expect(second.stoppedByLimit).toBe(false)
  })

  it('a configurable gap is honoured', async () => {
    const node = new DiscoveryNode()

    node.sent.add(3)

    expect(
      (await discoverUsedAccounts(node, addressAt, logger, { gapLimit: 2 })).usedIndexes,
    ).toEqual([])
  })
})

describe('Untrustworthy node reply', () => {
  it('a node that answers for every address hits the cap', async () => {
    /* That looks like either a decoy node or a fault: a live
       wallet does not have two hundred occupied addresses in a
       row. Only the caller can tell this from a real find, and
       the sign for them is a stop by the cap. */
    const node = new DiscoveryNode()

    for (let index = 0; index < MAX_SCANNED_ADDRESSES + 10; index += 1) {
      node.funded.add(index)
    }

    const result = await discoverUsedAccounts(node, addressAt, logger)

    expect(result.stoppedByLimit).toBe(true)
    expect(result.scanned).toBe(MAX_SCANNED_ADDRESSES)
  })
})
