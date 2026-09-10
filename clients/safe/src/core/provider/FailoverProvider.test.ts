import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventBus } from '@/core/events'
import { InsufficientFundsError, ProviderUnavailableError, RpcError } from '@/core/errors'
import { toAddress } from '@/core/address'
import { toChainId, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'
import { NullLogger } from '@/test/doubles'

import type { IProvider } from './contracts'
import { FailoverProvider } from './FailoverProvider'
import { RPC_PROVIDER_ID, type IRpcEndpoint } from './rpc-endpoint'
import type { ProviderEventMap } from './types'

const CHAIN_ID = toChainId(1n)
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

function endpoint(url: string): IRpcEndpoint {
  return { url, providerId: RPC_PROVIDER_ID.Public, providerName: 'Test' }
}

const ENDPOINTS = [
  endpoint('https://a.example'),
  endpoint('https://b.example'),
  endpoint('https://c.example'),
]

/** Stub-node behaviour for a given test. */
interface INodeBehaviour {
  /** Fail while connecting. */
  readonly failOnConnect?: boolean
  /** Transport failure on every call. */
  readonly failTransport?: boolean

  /** Node cannot do `eth_simulateV1` but is otherwise healthy. */
  readonly failSimulate?: boolean
  /** Node answers with a JSON-RPC error. */
  readonly rpcError?: boolean

  /**
   * Fail ONLY on log queries while the node stays healthy otherwise.
   *
   * That is how public nodes behave: measured live — "408" and "403"
   * on `eth_getLogs` from two nodes that were serving balance in the
   * same second.
   */
  readonly failLogs?: boolean

  readonly balance?: bigint
  readonly logs?: readonly never[]
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl: string
  isActive = true

  balanceCalls = 0
  sendCalls = 0
  logCalls = 0
  simulateCalls = 0

  readonly #behaviour: INodeBehaviour
  readonly #events = new EventBus<ProviderEventMap>()

  constructor(url: string, behaviour: INodeBehaviour) {
    this.rpcUrl = url
    this.#behaviour = behaviour
  }

  #fail(): never {
    if (this.#behaviour.rpcError === true) {
      throw new InsufficientFundsError(0n, 0n)
    }

    throw new ProviderUnavailableError(CHAIN_ID)
  }

  request<TResult>(request: { method: string }): Promise<TResult> {
    if (request.method !== 'eth_simulateV1') {
      return Promise.reject(new Error('not supported'))
    }

    this.simulateCalls += 1

    return this.#behaviour.failSimulate === true
      ? Promise.reject(new RpcError(-32601, 'the method does not exist'))
      : Promise.resolve('simulation' as TResult)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getBlockNumber(): Promise<bigint> {
    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve(1n)
  }

  getBalance(): Promise<Wei> {
    this.balanceCalls += 1

    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve((this.#behaviour.balance ?? 0n) as Wei)
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

  /** Bytecode at an address. Ordinary address: these tests do not check contracts. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  sendRawTransaction(): Promise<TxHash> {
    this.sendCalls += 1

    if (this.#behaviour.failTransport === true) {
      return Promise.reject(new ProviderUnavailableError(CHAIN_ID))
    }

    return Promise.resolve('0xhash' as TxHash)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getLogs(): Promise<readonly never[]> {
    this.logCalls += 1

    if (this.#behaviour.failLogs === true) {
      return Promise.reject(new RpcError(-32602, 'archive requests require a token'))
    }

    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve(this.#behaviour.logs ?? [])
  }

  destroy(): void {
    this.isActive = false
  }

  #error(): Error {
    try {
      this.#fail()
    } catch (error) {
      return error as Error
    }
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let behaviours: Map<string, INodeBehaviour>
let created: StubProvider[]

function createProvider(endpoints = ENDPOINTS, onSwitch: () => void = () => undefined) {
  return new FailoverProvider({
    chainId: CHAIN_ID,
    endpoints,
    logger: new NullLogger(),
    onSwitch,
    connect: (target) => {
      const behaviour = behaviours.get(target.url) ?? {}

      if (behaviour.failOnConnect === true) {
        return Promise.reject(new ProviderUnavailableError(CHAIN_ID))
      }

      const stub = new StubProvider(target.url, behaviour)
      created.push(stub)

      return Promise.resolve(stub)
    },
  })
}

beforeEach(() => {
  behaviours = new Map()
  created = []
})

describe('FailoverProvider: connect', () => {
  it('uses the first address in the list', async () => {
    behaviours.set('https://a.example', { balance: 5n })

    const provider = createProvider()

    expect(await provider.getBalance(OWNER)).toBe(5n)
    expect(provider.rpcUrl).toBe('https://a.example')
  })

  it('moves to the next address if the first does not connect', async () => {
    behaviours.set('https://a.example', { failOnConnect: true })
    behaviours.set('https://b.example', { balance: 7n })

    const provider = createProvider()

    expect(await provider.getBalance(OWNER)).toBe(7n)
    expect(provider.rpcUrl).toBe('https://b.example')
  })

  it('fails when no address connects', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failOnConnect: true })
    }

    await expect(createProvider().getBalance(OWNER)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('shares one connection among concurrent calls', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()

    await Promise.all([provider.getBalance(OWNER), provider.getBalance(OWNER)])

    expect(created).toHaveLength(1)
  })

  it('reports the active address with its source', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()
    await provider.getBalance(OWNER)

    expect(provider.activeEndpoint?.url).toBe('https://a.example')
    expect(provider.activeEndpoint?.providerId).toBe(RPC_PROVIDER_ID.Public)
  })
})

describe('FailoverProvider: node failure mid-session', () => {
  it('switches to a backup address and returns the result', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 42n })

    const provider = createProvider()

    /* Exactly what the old rotation could not do: a node that failed
       after connect doomed every call for the rest of the session. */
    expect(await provider.getBalance(OWNER)).toBe(42n)
    expect(provider.rpcUrl).toBe('https://b.example')
  })

  it('closes the connection to the failed node', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    await createProvider().getBalance(OWNER)

    expect(created[0]?.isActive).toBe(false)
  })

  it('does not return to a failed address on the next call', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    const provider = createProvider()

    await provider.getBalance(OWNER)
    await provider.getBalance(OWNER)

    /* Retrying an address that already failed would only lengthen the wait. */
    expect(created.filter((stub) => stub.rpcUrl === 'https://a.example')).toHaveLength(1)
  })

  it('notifies about a node change', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    const onSwitch = vi.fn()

    await createProvider(ENDPOINTS, onSwitch).getBalance(OWNER)

    expect(onSwitch).toHaveBeenCalledTimes(1)
  })

  it('fails when no backup addresses remain', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failTransport: true })
    }

    await expect(createProvider().getBalance(OWNER)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('reports itself unfit after exhausting the list', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failTransport: true })
    }

    const provider = createProvider()

    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(ProviderUnavailableError)

    /* Otherwise `RpcManager` would keep an empty shell in cache, and
       the wallet would report the network unavailable with healthy
       nodes until reload. */
    expect(provider.isActive).toBe(false)
  })
})

/**
 * A log failure condemns the request, not the node.
 *
 * Behaviour checked on live nodes: `eth.drpc.org` answered "408" and
 * `ethereum-rpc.publicnode.com` answered "403: archive token required",
 * while both served balance in the same second. Ordinary rotation would
 * drop a node on every history visit and leave the wallet with no
 * connection.
 */
describe('FailoverProvider: log query', () => {
  const ANY_FILTER = { fromBlock: 0n, toBlock: 1n }

  it('keeps the node in service when it refused only logs', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failLogs: true })
    }
    behaviours.set('https://a.example', { failLogs: true, balance: 3n })

    const provider = createProvider()

    await expect(provider.getLogs(ANY_FILTER)).rejects.toBeInstanceOf(RpcError)

    /* The point of this check: the node stayed working. History must
       not cost the wallet its balance and send. */
    expect(await provider.getBalance(OWNER)).toBe(3n)
    expect(provider.rpcUrl).toBe('https://a.example')
  })

  it('asks a neighbor for simulation when the active node cannot do it', async () => {
    /* Live measurement: a gateway that serves logs refuses simulation,
       and a node that simulates does not serve logs. Without neighbor
       probing, one of the two would always stay unavailable. */
    behaviours.set('https://a.example', { failSimulate: true, balance: 3n })

    const provider = createProvider()

    expect(await provider.request({ method: 'eth_simulateV1', params: [] })).toBe('simulation')

    /* The active node did not change: it is healthy, it just cannot
       do this particular call. */
    expect(provider.rpcUrl).toBe('https://a.example')
    expect(await provider.getBalance(OWNER)).toBe(3n)
  })

  it('takes logs from a neighbor when the active node refused them', async () => {
    behaviours.set('https://a.example', { failLogs: true, balance: 3n })

    const provider = createProvider()

    expect(await provider.getLogs(ANY_FILTER)).toStrictEqual([])

    /* The neighbor answered but did not become active: it was asked and released. */
    expect(provider.rpcUrl).toBe('https://a.example')
    expect(created.find((stub) => stub.rpcUrl === 'https://b.example')?.logCalls).toBe(1)
  })

  it('closes the temporary neighbor connection', async () => {
    behaviours.set('https://a.example', { failLogs: true })

    await createProvider().getLogs(ANY_FILTER)

    expect(created.find((stub) => stub.rpcUrl === 'https://b.example')?.isActive).toBe(false)
  })

  it('surfaces the active node error when every node refused', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failLogs: true })
    }

    /* What surfaces is the answer of the node the wallet is using,
       not a random neighbor probed last. */
    await expect(createProvider().getLogs(ANY_FILTER)).rejects.toMatchObject({ rpcCode: -32602 })
  })
})

describe('FailoverProvider: a node error is not a transport failure', () => {
  it('does not switch when the node answered with an error', async () => {
    behaviours.set('https://a.example', { rpcError: true })
    behaviours.set('https://b.example', { balance: 1n })

    const provider = createProvider()

    /* The node that answered is working. A second one would say the
       same: insufficient funds does not depend on whom you ask. */
    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(created).toHaveLength(1)
  })

  it('surfaces the original error to the caller', async () => {
    behaviours.set('https://a.example', { rpcError: true })

    await expect(createProvider().getBalance(OWNER)).rejects.not.toBeInstanceOf(RpcError)
  })
})

describe('FailoverProvider: transaction send', () => {
  it('does not retry the send on another node', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', {})

    const provider = createProvider()

    /* The fate of the first send is unknown: the node may have accepted
       the transaction and failed to reply. The second node would return
       "already known", and the wallet would show a failure for an
       accepted transaction. */
    await expect(provider.sendRawTransaction('0xsigned' as HexString)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
    expect(created).toHaveLength(1)
  })

  it('sends through the active node', async () => {
    behaviours.set('https://a.example', {})

    expect(await createProvider().sendRawTransaction('0xsigned' as HexString)).toBe('0xhash')
  })
})

describe('FailoverProvider: destroy', () => {
  it('closes the active connection', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()
    await provider.getBalance(OWNER)

    provider.destroy()

    expect(provider.isActive).toBe(false)
    expect(created[0]?.isActive).toBe(false)
  })

  it('rejects calls after destroy', async () => {
    const provider = createProvider()
    provider.destroy()

    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(ProviderUnavailableError)
  })
})
