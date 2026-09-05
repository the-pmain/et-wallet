import { beforeEach, describe, expect, it } from 'vitest'

import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import { BUILT_IN_CHAIN_ID, type INetworkConfig } from '@/core/network'
import { toChainId, type ChainId } from '@/core/types'
import { FakeJsonRpcNode, NullLogger } from '@/test/doubles'

import type { IProvider } from './contracts'
import { RpcClient } from './RpcClient'
import { RpcClientFactory } from './RpcClientFactory'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum

/**
 * Factory with a substituted connect.
 *
 * Rotation rules are checked without talking to the network: real
 * requests would make the suite slow and non-deterministic, and what
 * is checked here is node-selection logic, not transport. Transport
 * itself is covered separately in `RpcClient.test.ts`.
 */
class TestableFactory extends RpcClientFactory {
  /** Behaviour of each address: a node or an error. */
  readonly nodes = new Map<string, FakeJsonRpcNode | Error>()

  /** Addresses in the order they were actually tried. */
  readonly attempts: string[] = []

  protected override async connect(rpcUrl: string, chainId: ChainId): Promise<IProvider> {
    this.attempts.push(rpcUrl)

    const entry = this.nodes.get(rpcUrl)

    if (entry === undefined || entry instanceof Error) {
      throw entry ?? new Error(`node ${rpcUrl} is unavailable`)
    }

    return await RpcClient.attach(entry, chainId, rpcUrl)
  }
}

function network(rpcUrls: readonly string[]): INetworkConfig {
  return {
    chainId: CHAIN_ID,
    name: 'Test network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls,
    blockExplorerUrls: [],
    isTestnet: false,
    isBuiltIn: false,
    supportsEip1559: true,
  }
}

let logger: NullLogger
let factory: TestableFactory

beforeEach(() => {
  logger = new NullLogger()
  factory = new TestableFactory({ logger })
})

describe('RpcClientFactory: node selection', () => {
  it('connects to the first available address', async () => {
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(network(['https://a.example.com']))

    try {
      expect(provider.rpcUrl).toBe('https://a.example.com')
      expect(provider.isActive).toBe(true)
    } finally {
      provider.destroy()
    }
  })

  it('honors priority order', async () => {
    factory.nodes.set('https://first.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))
    factory.nodes.set('https://second.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://first.example.com', 'https://second.example.com']),
    )

    try {
      /* The list is in priority order: the most reliable operator is
         usually first, so rotation must not be shuffled. */
      expect(provider.rpcUrl).toBe('https://first.example.com')
      expect(factory.attempts).toEqual(['https://first.example.com'])
    } finally {
      provider.destroy()
    }
  })

  it('moves to a backup address when the primary fails', async () => {
    factory.nodes.set('https://down.example.com', new Error('connection refused'))
    factory.nodes.set('https://backup.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://down.example.com', 'https://backup.example.com']),
    )

    try {
      expect(provider.rpcUrl).toBe('https://backup.example.com')
      expect(factory.attempts).toHaveLength(2)
    } finally {
      provider.destroy()
    }
  })

  it('skips a node that serves another network', async () => {
    /* A node with a foreign chainId is dropped from rotation but does
       not fail the whole attempt: the backup may be healthy. */
    factory.nodes.set('https://wrong-chain.example.com', new FakeJsonRpcNode(137))
    factory.nodes.set('https://correct.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://wrong-chain.example.com', 'https://correct.example.com']),
    )

    try {
      expect(provider.rpcUrl).toBe('https://correct.example.com')
    } finally {
      provider.destroy()
    }
  })
})

describe('RpcClientFactory: failure', () => {
  it('fails on an empty address list', async () => {
    await expect(factory.create(network([]))).rejects.toThrow(ProviderUnavailableError)
  })

  it('fails when no node is available', async () => {
    factory.nodes.set('https://a.example.com', new Error('timeout'))
    factory.nodes.set('https://b.example.com', new Error('timeout'))

    await expect(
      factory.create(network(['https://a.example.com', 'https://b.example.com'])),
    ).rejects.toThrow(ProviderUnavailableError)

    expect(factory.attempts).toHaveLength(2)
  })

  it('keeps the cause of the last attempt', async () => {
    factory.nodes.set('https://wrong-chain.example.com', new FakeJsonRpcNode(137))

    /* With a single node on a foreign chainId the user must see that
       reason, not a generic "network unavailable". */
    await expect(
      factory.create(network(['https://wrong-chain.example.com'])),
    ).rejects.toMatchObject({ cause: expect.any(ChainIdMismatchError) as unknown })
  })
})

describe('RpcClientFactory: log', () => {
  it('writes a warning about an unreachable node', async () => {
    factory.nodes.set('https://a.example.com', new Error('timeout'))

    await expect(factory.create(network(['https://a.example.com']))).rejects.toThrow()

    const warnings = logger.records.filter((record) => record.level === 'warn')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.context?.['rpcUrl']).toBe('https://a.example.com')
  })

  it('marks a node with a foreign chainId separately', async () => {
    /* This is either a config error or an impersonation attempt —
       both deserve attention and must not be lost among network
       failures. */
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(137))

    await expect(factory.create(network(['https://a.example.com']))).rejects.toThrow()

    const warning = logger.records.find((record) => record.context?.['actual'] !== undefined)

    expect(warning?.context?.['expected']).toBe('1')
    expect(warning?.context?.['actual']).toBe('137')
  })

  it('writes no warnings on a successful connect', async () => {
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(network(['https://a.example.com']))

    try {
      expect(logger.records.filter((record) => record.level === 'warn')).toHaveLength(0)
    } finally {
      provider.destroy()
    }
  })

  it('works with a non-standard network id', async () => {
    const custom = toChainId(31337)
    factory.nodes.set('https://local.example.com', new FakeJsonRpcNode(Number(custom)))

    const provider = await factory.create({
      ...network(['https://local.example.com']),
      chainId: custom,
    })

    try {
      expect(provider.chainId).toBe(custom)
    } finally {
      provider.destroy()
    }
  })
})
